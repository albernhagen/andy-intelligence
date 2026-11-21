import { describe, expect, it } from "vitest";
import { ProviderKey } from "../entities/common";
import type { SpendCapLimits, SpendEntry } from "../entities/spend";
import type { SpendLedger } from "../ports/spend";

const AT = "2026-11-20T12:00:00.000Z";
const LATER = "2026-11-20T13:00:00.000Z";

/** A reservation fixture: `n` names it, amounts in micro-dollars. */
export const spendEntry = (n: number, over: Partial<SpendEntry> = {}): SpendEntry => ({
  id: `spend-${n}`,
  runId: `run-${n}`,
  projectId: "ai",
  provider: "openrouter",
  model: "example/model-1",
  state: "reserved",
  reservedMicroUsd: 1_000_000,
  settledMicroUsd: null,
  at: AT,
  settledAt: null,
  ...over,
});

export const NO_SPEND_CAP_LIMITS: SpendCapLimits = {
  per_task: null,
  project_daily: null,
  project_monthly: null,
  global_daily: null,
  global_monthly: null,
};
const caps = (over: Partial<SpendCapLimits>): SpendCapLimits => ({
  ...NO_SPEND_CAP_LIMITS,
  ...over,
});

export interface SpendLedgerContractOptions {
  /** Timeout (ms) for the case that races reservations; see `NotifyLedgerContractOptions`. */
  raceTimeoutMs?: number;
}

/** `make` must return a ledger with nothing recorded. */
export function spendLedgerContract(
  name: string,
  make: () => Promise<SpendLedger>,
  options: SpendLedgerContractOptions = {},
): void {
  const itRaces = (title: string, fn: () => Promise<void>) => it(title, fn, options.raceTimeoutMs);

  describe(`SpendLedger contract: ${name}`, () => {
    it("GivenNothingRecorded_WhenTotalsRead_ThenZeroForTheDayAndMonth", async () => {
      expect(await (await make()).totals({}, AT)).toEqual({
        day: "2026-11-20",
        dayMicroUsd: 0,
        month: "2026-11",
        monthMicroUsd: 0,
      });
    });

    it("GivenRoomUnderEveryCap_WhenReserved_ThenRecordedAndCounted", async () => {
      const ledger = await make();
      const out = await ledger.reserve(spendEntry(1), caps({ project_daily: 5_000_000 }));
      expect(out).toEqual({ ok: true, entry: spendEntry(1) });
      expect(await ledger.get("spend-1")).toEqual(spendEntry(1));
      expect((await ledger.totals({ projectId: "ai" }, AT)).dayMicroUsd).toBe(1_000_000);
    });

    it.each([
      ["per_task", caps({ per_task: 999_999 }), 0],
      ["project_daily", caps({ project_daily: 1_500_000 }), 1_000_000],
      ["project_monthly", caps({ project_monthly: 1_500_000 }), 1_000_000],
      ["global_daily", caps({ global_daily: 2_500_000 }), 2_000_000],
      ["global_monthly", caps({ global_monthly: 2_500_000 }), 2_000_000],
    ] as const)(
      "GivenAReservationThatWouldPass %s_WhenReserved_ThenNothingRecordedAndThatCapReturned",
      async (cap, limits, used) => {
        const ledger = await make();
        await ledger.reserve(spendEntry(1), NO_SPEND_CAP_LIMITS);
        await ledger.reserve(spendEntry(2, { projectId: "other" }), NO_SPEND_CAP_LIMITS);
        const out = await ledger.reserve(spendEntry(3), limits);
        expect(out).toEqual({
          ok: false,
          cap,
          limitMicroUsd: Object.values(limits).find((v) => v !== null),
          usedMicroUsd: used,
        });
        expect(await ledger.get("spend-3")).toBeNull();
        expect((await ledger.totals({}, AT)).dayMicroUsd).toBe(2_000_000);
      },
    );

    it("GivenAReservationExactlyAtTheCap_WhenReserved_ThenRecorded", async () => {
      const ledger = await make();
      const out = await ledger.reserve(spendEntry(1), caps({ per_task: 1_000_000 }));
      expect(out.ok).toBe(true);
    });

    itRaces(
      "GivenTwoReservationsRacingForTheLastRoom_WhenBothRun_ThenAtMostOneRecorded",
      async () => {
        const ledger = await make();
        const limit = caps({ global_daily: 1_500_000 });
        const outs = await Promise.all([
          ledger.reserve(spendEntry(1), limit),
          ledger.reserve(spendEntry(2), limit),
        ]);
        expect(outs.filter((o) => o.ok)).toHaveLength(1);
        expect((await ledger.totals({}, AT)).dayMicroUsd).toBe(1_000_000);
      },
    );

    it("GivenARecordedId_WhenReservedAgain_ThenTheSameEntryCountedOnce", async () => {
      const ledger = await make();
      await ledger.reserve(spendEntry(1), NO_SPEND_CAP_LIMITS);
      const again = await ledger.reserve(spendEntry(1), caps({ per_task: 0 }));
      expect(again).toEqual({ ok: true, entry: spendEntry(1) });
      expect((await ledger.totals({}, AT)).dayMicroUsd).toBe(1_000_000);
    });

    it.each([
      ["another amount", { reservedMicroUsd: 9_000_000 }],
      ["another project", { projectId: "other" }],
      ["another run", { runId: "run-x" }],
      ["another model", { model: "example/model-2" }],
    ] as const)(
      "GivenARecordedIdRetriedWith %s_WhenReserved_ThenConflictAndNothingChanges",
      async (_label, over) => {
        const ledger = await make();
        await ledger.reserve(spendEntry(1), NO_SPEND_CAP_LIMITS);
        await expect(
          ledger.reserve(spendEntry(1, over), NO_SPEND_CAP_LIMITS),
        ).rejects.toMatchObject({ code: "conflict" });
        expect(await ledger.get("spend-1")).toEqual(spendEntry(1));
        expect((await ledger.totals({}, AT)).dayMicroUsd).toBe(1_000_000);
      },
    );

    it("GivenAnActualCost_WhenSettled_ThenItCountsInsteadOfTheReservation", async () => {
      const ledger = await make();
      await ledger.reserve(spendEntry(1), NO_SPEND_CAP_LIMITS);
      const settled = await ledger.settle("spend-1", 250_000, LATER);
      expect(settled).toEqual({
        ...spendEntry(1),
        state: "settled",
        settledMicroUsd: 250_000,
        settledAt: LATER,
      });
      expect((await ledger.totals({ projectId: "ai" }, AT)).dayMicroUsd).toBe(250_000);
    });

    it("GivenAnUnknownCost_WhenSettled_ThenTheFullReservationCounts", async () => {
      const ledger = await make();
      await ledger.reserve(spendEntry(1), NO_SPEND_CAP_LIMITS);
      expect((await ledger.settle("spend-1", null, LATER))?.settledMicroUsd).toBe(1_000_000);
      expect((await ledger.totals({}, AT)).dayMicroUsd).toBe(1_000_000);
    });

    it("GivenAReleasedReservation_WhenTotalsRead_ThenItCountsNothing", async () => {
      const ledger = await make();
      await ledger.reserve(spendEntry(1), NO_SPEND_CAP_LIMITS);
      const released = await ledger.release("spend-1", LATER);
      expect(released).toMatchObject({
        state: "released",
        settledMicroUsd: null,
        settledAt: LATER,
      });
      expect((await ledger.totals({}, AT)).dayMicroUsd).toBe(0);
    });

    it("GivenASettledOrReleasedEntry_WhenSettledOrReleasedAgain_ThenUnchanged", async () => {
      const ledger = await make();
      await ledger.reserve(spendEntry(1), NO_SPEND_CAP_LIMITS);
      await ledger.reserve(spendEntry(2), NO_SPEND_CAP_LIMITS);
      const settled = await ledger.settle("spend-1", 300_000, LATER);
      const released = await ledger.release("spend-2", LATER);
      expect(await ledger.settle("spend-1", 900_000, "2026-11-20T14:00:00.000Z")).toEqual(settled);
      expect(await ledger.release("spend-1", "2026-11-20T14:00:00.000Z")).toEqual(settled);
      expect(await ledger.settle("spend-2", 900_000, "2026-11-20T14:00:00.000Z")).toEqual(released);
      expect((await ledger.totals({}, AT)).dayMicroUsd).toBe(300_000);
    });

    it("GivenAnUnknownId_WhenSettledReleasedOrRead_ThenNull", async () => {
      const ledger = await make();
      expect(await ledger.settle("nope", 1, LATER)).toBeNull();
      expect(await ledger.release("nope", LATER)).toBeNull();
      expect(await ledger.get("nope")).toBeNull();
    });

    it("GivenEntriesAcrossDaysMonthsAndProjects_WhenTotalsRead_ThenEachWindowAndScopeApart", async () => {
      const ledger = await make();
      await ledger.reserve(spendEntry(1), NO_SPEND_CAP_LIMITS);
      await ledger.reserve(spendEntry(2, { at: "2026-11-02T08:00:00.000Z" }), NO_SPEND_CAP_LIMITS);
      await ledger.reserve(spendEntry(3, { at: "2026-10-31T23:59:59.000Z" }), NO_SPEND_CAP_LIMITS);
      await ledger.reserve(spendEntry(4, { projectId: "other" }), NO_SPEND_CAP_LIMITS);
      expect(await ledger.totals({ projectId: "ai" }, AT)).toMatchObject({
        dayMicroUsd: 1_000_000,
        monthMicroUsd: 2_000_000,
      });
      expect(await ledger.totals({}, AT)).toMatchObject({
        dayMicroUsd: 2_000_000,
        monthMicroUsd: 3_000_000,
      });
      // Totals are UTC: the 31 October entry is in October.
      expect(await ledger.totals({}, "2026-10-31T12:00:00.000Z")).toMatchObject({
        month: "2026-10",
        monthMicroUsd: 1_000_000,
      });
    });

    it("GivenNothingRecorded_WhenTotalsByProviderRead_ThenOneZeroRowPerProvider", async () => {
      const rows = await (await make()).totalsByProvider({}, AT);
      expect(rows.map((r) => r.provider)).toEqual(ProviderKey.options);
      expect(rows.every((r) => r.dayMicroUsd === 0 && r.monthMicroUsd === 0)).toBe(true);
      expect(rows[0]).toMatchObject({ day: "2026-11-20", month: "2026-11" });
    });

    it("GivenSpendOnTwoProvidersAndProjects_WhenTotalsByProviderRead_ThenSplitByProviderAndScope", async () => {
      const ledger = await make();
      await ledger.reserve(spendEntry(1), NO_SPEND_CAP_LIMITS);
      await ledger.reserve(
        spendEntry(2, { provider: "claude-sub", reservedMicroUsd: 300_000 }),
        NO_SPEND_CAP_LIMITS,
      );
      await ledger.reserve(
        spendEntry(3, { projectId: "other", reservedMicroUsd: 500_000 }),
        NO_SPEND_CAP_LIMITS,
      );
      await ledger.reserve(
        spendEntry(4, { at: "2026-11-02T08:00:00.000Z", reservedMicroUsd: 200_000 }),
        NO_SPEND_CAP_LIMITS,
      );
      const byProvider = async (projectId?: string) =>
        Object.fromEntries(
          (await ledger.totalsByProvider(projectId ? { projectId } : {}, AT)).map((r) => [
            r.provider,
            [r.dayMicroUsd, r.monthMicroUsd],
          ]),
        );
      expect(await byProvider("ai")).toMatchObject({
        openrouter: [1_000_000, 1_200_000],
        "claude-sub": [300_000, 300_000],
        "google-sub": [0, 0],
      });
      expect(await byProvider()).toMatchObject({
        openrouter: [1_500_000, 1_700_000],
        "claude-sub": [300_000, 300_000],
      });
    });

    it("GivenSettledAndReleasedEntries_WhenTotalsByProviderRead_ThenTheyCountAsTheTotalsDo", async () => {
      const ledger = await make();
      await ledger.reserve(spendEntry(1), NO_SPEND_CAP_LIMITS);
      await ledger.reserve(spendEntry(2, { provider: "claude-sub" }), NO_SPEND_CAP_LIMITS);
      await ledger.settle("spend-1", 250_000, LATER);
      await ledger.release("spend-2", LATER);
      const rows = await ledger.totalsByProvider({ projectId: "ai" }, AT);
      expect(rows.find((r) => r.provider === "openrouter")?.dayMicroUsd).toBe(250_000);
      expect(rows.find((r) => r.provider === "claude-sub")?.dayMicroUsd).toBe(0);
      const sum = rows.reduce((n, r) => n + r.dayMicroUsd, 0);
      expect(sum).toBe((await ledger.totals({ projectId: "ai" }, AT)).dayMicroUsd);
    });

    itRaces(
      "GivenConcurrentReservesOnDifferentProviders_WhenAllFinish_ThenEachProviderCountsItsOwn",
      async () => {
        const ledger = await make();
        await Promise.all([
          ledger.reserve(spendEntry(1), NO_SPEND_CAP_LIMITS),
          ledger.reserve(spendEntry(2, { provider: "claude-sub" }), NO_SPEND_CAP_LIMITS),
          ledger.reserve(spendEntry(3), NO_SPEND_CAP_LIMITS),
        ]);
        const rows = await ledger.totalsByProvider({}, AT);
        expect(rows.find((r) => r.provider === "openrouter")?.dayMicroUsd).toBe(2_000_000);
        expect(rows.find((r) => r.provider === "claude-sub")?.dayMicroUsd).toBe(1_000_000);
        expect((await ledger.totals({}, AT)).dayMicroUsd).toBe(3_000_000);
      },
    );

    it("GivenAnInvalidEntryOrAmount_WhenWritten_ThenRejectedAndNothingCounts", async () => {
      const ledger = await make();
      await expect(
        ledger.reserve(spendEntry(1, { reservedMicroUsd: 0.5 }), NO_SPEND_CAP_LIMITS),
      ).rejects.toThrow();
      await expect(
        ledger.reserve(spendEntry(2, { reservedMicroUsd: -1 }), NO_SPEND_CAP_LIMITS),
      ).rejects.toThrow();
      await expect(
        ledger.reserve(
          spendEntry(3, { state: "settled", settledMicroUsd: 1 }),
          NO_SPEND_CAP_LIMITS,
        ),
      ).rejects.toThrow();
      await ledger.reserve(spendEntry(4), NO_SPEND_CAP_LIMITS);
      await expect(ledger.settle("spend-4", 1.5, LATER)).rejects.toThrow();
      expect((await ledger.get("spend-4"))?.state).toBe("reserved");
      expect((await ledger.totals({}, AT)).dayMicroUsd).toBe(1_000_000);
    });
  });
}
