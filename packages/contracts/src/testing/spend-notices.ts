import { describe, expect, it } from "vitest";
import type { SpendNoticeState } from "../entities/spend-notices";
import type { SpendNoticeLedger } from "../ports/spend-notices";

const state = (sentToday: number, sent: string[] = []): SpendNoticeState => ({
  day: "2026-11-21",
  sentToday,
  sent,
});

export interface SpendNoticeLedgerContractOptions {
  /** Timeout (ms) for the case that races updates; see `NotifyLedgerContractOptions`. */
  raceTimeoutMs?: number;
}

/** `make` must return a ledger with nothing stored. */
export function spendNoticeLedgerContract(
  name: string,
  make: () => Promise<SpendNoticeLedger>,
  options: SpendNoticeLedgerContractOptions = {},
): void {
  const itRaces = (title: string, fn: () => Promise<void>) => it(title, fn, options.raceTimeoutMs);

  describe(`SpendNoticeLedger contract: ${name}`, () => {
    it("GivenNothingStored_WhenRead_ThenNull", async () => {
      expect(await (await make()).get()).toBeNull();
    });

    it("GivenAnUpdate_WhenRead_ThenTheNewStateAndResultComeBack", async () => {
      const ledger = await make();
      const result = await ledger.update(() => ({
        state: state(1, ["warn|x|ai|2026-11"]),
        result: "ok",
      }));
      expect(result).toBe("ok");
      expect(await ledger.get()).toEqual(state(1, ["warn|x|ai|2026-11"]));
    });

    itRaces("GivenConcurrentIncrements_WhenAllFinish_ThenNoneIsLost", async () => {
      const ledger = await make();
      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          ledger.update((s) => ({
            state: state((s?.sentToday ?? 0) + 1, [...(s?.sent ?? []), `k${i}`]),
            result: null,
          })),
        ),
      );
      const stored = await ledger.get();
      expect(stored?.sentToday).toBe(5);
      expect(stored?.sent).toHaveLength(5);
    });

    it("GivenAnInvalidState_WhenUpdated_ThenRejectedAndNothingChanges", async () => {
      const ledger = await make();
      await ledger.update(() => ({ state: state(2), result: null }));
      await expect(ledger.update(() => ({ state: state(-1), result: null }))).rejects.toThrow();
      expect((await ledger.get())?.sentToday).toBe(2);
    });
  });
}
