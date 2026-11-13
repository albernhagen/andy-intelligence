import { describe, expect, it } from "vitest";
import { ConfigChange } from "../entities";
import { ReviewFinding } from "../entities/config-proposals";
import type { ConfigChangeStore, ReviewFindingSource } from "../ports/config-proposals";

export interface ConfigChangeStoreContractOptions {
  /** Per-test timeout for the concurrent case: emulator transactions retry under contention. */
  raceTimeoutMs?: number;
}

/** A pending proposal for tests; override any field. */
export function pendingConfigChange(overrides: Partial<ConfigChange> = {}): ConfigChange {
  return ConfigChange.parse({
    id: crypto.randomUUID(),
    entity: "agent_config",
    entityId: "AGENTS.md",
    diff: { file: "AGENTS.md" },
    actor: "agent",
    reason: "repeated review findings",
    status: "pending",
    createdAt: "2026-11-12T10:00:00.000Z",
    appliedAt: null,
    projectId: "ai",
    dedupeKey: `key-${crypto.randomUUID()}`,
    ...overrides,
  });
}

/** `make` must return a store with nothing in it. */
export function configChangeStoreContract(
  name: string,
  make: () => Promise<ConfigChangeStore>,
  options: ConfigChangeStoreContractOptions = {},
): void {
  const itRaces = (title: string, fn: () => Promise<void>) => it(title, fn, options.raceTimeoutMs);
  const at = "2026-11-12T11:00:00.000Z";

  describe(`ConfigChangeStore contract: ${name}`, () => {
    it("GivenAPendingChange_WhenCreatedAndRead_ThenItComesBackEqual", async () => {
      const store = await make();
      const change = pendingConfigChange();

      expect(await store.createPending(change, 10)).toEqual({ outcome: "created", change });
      expect(await store.get(change.id)).toEqual(change);
      expect(await store.get(crypto.randomUUID())).toBeNull();
    });

    it("GivenAPendingChangeWithAKey_WhenAnotherWithTheSameKeyIsCreated_ThenTheFirstComesBack", async () => {
      const store = await make();
      const first = pendingConfigChange({ dedupeKey: "same" });
      await store.createPending(first, 10);

      const again = await store.createPending(pendingConfigChange({ dedupeKey: "same" }), 10);

      expect(again).toEqual({ outcome: "duplicate", change: first });
      expect(await store.listPending()).toHaveLength(1);
    });

    it("GivenARejectedChange_WhenOneWithTheSameKeyIsCreated_ThenItIsStored", async () => {
      const store = await make();
      const first = pendingConfigChange({ dedupeKey: "same" });
      await store.createPending(first, 10);
      await store.decide(first.id, "rejected", "andy", at);

      const again = await store.createPending(pendingConfigChange({ dedupeKey: "same" }), 10);

      expect(again.outcome).toBe("created");
    });

    it("GivenTheProjectAtItsPendingCap_WhenAnotherIsCreated_ThenCappedAndNothingWritten", async () => {
      const store = await make();
      await store.createPending(pendingConfigChange(), 2);
      await store.createPending(pendingConfigChange(), 2);
      await store.createPending(pendingConfigChange({ projectId: "other" }), 2);

      expect(await store.createPending(pendingConfigChange(), 2)).toEqual({
        outcome: "capped",
        change: null,
      });
      expect(await store.listPending("ai")).toHaveLength(2);
    });

    it("GivenANonPendingChange_WhenCreated_ThenConflict", async () => {
      const store = await make();
      await expect(
        store.createPending(pendingConfigChange({ status: "applied" }), 10),
      ).rejects.toMatchObject({ name: "WorkTrackerError", code: "conflict" });
    });

    itRaces("GivenConcurrentCreatesWithOneKey_WhenRacing_ThenOnlyOneIsStored", async () => {
      const store = await make();
      const results = await Promise.all(
        [1, 2, 3].map(() => store.createPending(pendingConfigChange({ dedupeKey: "race" }), 10)),
      );
      expect(results.filter((r) => r.outcome === "created")).toHaveLength(1);
      expect(await store.listPending()).toHaveLength(1);
    });

    itRaces(
      "GivenConcurrentCreatesOfDifferentKeys_WhenRacingForTheLastSlot_ThenOnlyOneWins",
      async () => {
        const store = await make();
        await store.createPending(pendingConfigChange(), 2);
        const results = await Promise.all(
          [1, 2, 3].map(() => store.createPending(pendingConfigChange(), 2)),
        );
        expect(results.filter((r) => r.outcome === "created")).toHaveLength(1);
        expect(await store.listPending("ai")).toHaveLength(2);
      },
    );

    it("GivenChanges_WhenPendingAreListed_ThenAllPendingOfTheProjectNewestFirst", async () => {
      const store = await make();
      const older = pendingConfigChange({ createdAt: "2026-11-12T09:00:00.000Z" });
      const newer = pendingConfigChange({ createdAt: "2026-11-12T10:00:00.000Z" });
      const other = pendingConfigChange({ projectId: "other" });
      const rejected = pendingConfigChange();
      for (const c of [older, newer, other, rejected]) await store.createPending(c, 10);
      await store.decide(rejected.id, "rejected", "andy", at);

      expect((await store.listPending("ai")).map((c) => c.id)).toEqual([newer.id, older.id]);
      expect(await store.listPending()).toHaveLength(3);
    });

    for (const decision of ["accepted", "rejected"] as const) {
      it(`GivenAPendingChange_WhenDecided${decision}_ThenItRecordsWhoAndWhenAndIsNotApplied`, async () => {
        const store = await make();
        const change = pendingConfigChange();
        await store.createPending(change, 10);

        const decided = await store.decide(change.id, decision, "andy", at);

        expect(decided).toMatchObject({
          status: decision,
          decidedBy: "andy",
          decidedAt: at,
          appliedAt: null,
        });
        expect(await store.get(change.id)).toEqual(decided);
        expect(await store.listPending()).toEqual([]);
      });
    }

    it("GivenAKeyDecidedTwice_WhenTheLatestDecisionIsRead_ThenTheNewestDecisionComesBack", async () => {
      const store = await make();
      const first = pendingConfigChange({ dedupeKey: "k" });
      await store.createPending(first, 10);
      await store.decide(first.id, "rejected", "andy", "2026-11-12T11:00:00.000Z");
      const second = pendingConfigChange({ dedupeKey: "k" });
      await store.createPending(second, 10);
      await store.decide(second.id, "accepted", "andy", "2026-11-12T12:00:00.000Z");
      await store.createPending(pendingConfigChange({ dedupeKey: "k" }), 10);

      expect(await store.latestDecision("k")).toMatchObject({ id: second.id, status: "accepted" });
      expect(await store.latestDecision("other")).toBeNull();
    });

    it("GivenNoCursorYet_WhenSetAndReadForTwoProjects_ThenEachReadsItsOwnAndTheLatestWins", async () => {
      const store = await make();
      expect(await store.getLookupCursor("ai")).toBeNull();
      await store.setLookupCursor({ projectId: "ai", lastKind: "a-kind", updatedAt: at });
      await store.setLookupCursor({ projectId: "ops", lastKind: "z-kind", updatedAt: at });
      await store.setLookupCursor({
        projectId: "ai",
        lastKind: "b-kind",
        updatedAt: "2026-11-12T12:00:00.000Z",
      });

      expect(await store.getLookupCursor("ai")).toEqual({
        projectId: "ai",
        lastKind: "b-kind",
        updatedAt: "2026-11-12T12:00:00.000Z",
      });
      expect(await store.getLookupCursor("ops")).toMatchObject({ lastKind: "z-kind" });
    });

    it("GivenADecidedOrUnknownChange_WhenDecided_ThenConflictOrNotFound", async () => {
      const store = await make();
      const change = pendingConfigChange();
      await store.createPending(change, 10);
      await store.decide(change.id, "rejected", "andy", at);

      await expect(store.decide(change.id, "accepted", "andy", at)).rejects.toMatchObject({
        code: "conflict",
      });
      await expect(store.decide(crypto.randomUUID(), "rejected", "andy", at)).rejects.toMatchObject(
        { code: "not_found" },
      );
    });
  });
}

/** A finding for tests; override any field. */
export function reviewFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return ReviewFinding.parse({
    projectId: "ai",
    repo: "albernhagen/andy-intelligence",
    pullNumber: 1,
    reviewer: "adversarial",
    severity: "should-fix",
    kind: "missing-test",
    title: "No test for the error path",
    file: "packages/domain/src/x.ts",
    headSha: "abc1234",
    recordedAt: "2026-11-12T10:00:00.000Z",
    ...overrides,
  });
}

/** `make` must return a source holding exactly `findings`. */
export function reviewFindingSourceContract(
  name: string,
  make: (findings: ReviewFinding[]) => Promise<ReviewFindingSource>,
): void {
  describe(`ReviewFindingSource contract: ${name}`, () => {
    const at = (minute: number) => `2026-11-12T10:${String(minute).padStart(2, "0")}:00.000Z`;

    it("GivenFindingsInTwoProjects_WhenReadForOne_ThenOnlyItsComeBackNewestFirst", async () => {
      const a = reviewFinding({ pullNumber: 1, recordedAt: at(1) });
      const b = reviewFinding({ pullNumber: 2, recordedAt: at(2) });
      const other = reviewFinding({ projectId: "other", recordedAt: at(3) });
      const source = await make([a, b, other]);

      expect(await source.recent("ai", { maxPulls: 10, maxFindings: 10 })).toEqual([b, a]);
    });

    it("GivenFindingsOnThreePulls_WhenReadWithMaxPullsTwo_ThenTheOldestPullIsLeftOut", async () => {
      const old = reviewFinding({ pullNumber: 1, recordedAt: at(1) });
      const mid = reviewFinding({ pullNumber: 2, recordedAt: at(2) });
      const midAgain = reviewFinding({ pullNumber: 2, recordedAt: at(3), kind: "other-kind" });
      const recent = reviewFinding({ pullNumber: 3, recordedAt: at(4) });
      const source = await make([old, mid, midAgain, recent]);

      const read = await source.recent("ai", { maxPulls: 2, maxFindings: 10 });

      expect(read.map((f) => f.pullNumber)).toEqual([3, 2, 2]);
    });

    it("GivenManyFindings_WhenReadWithMaxFindings_ThenCapped", async () => {
      const findings = [1, 2, 3, 4].map((n) => reviewFinding({ pullNumber: n, recordedAt: at(n) }));
      const source = await make(findings);

      expect(await source.recent("ai", { maxPulls: 10, maxFindings: 2 })).toHaveLength(2);
    });

    it("GivenNoFindings_WhenRead_ThenEmpty", async () => {
      const source = await make([]);
      expect(await source.recent("ai", { maxPulls: 10, maxFindings: 10 })).toEqual([]);
    });
  });
}
