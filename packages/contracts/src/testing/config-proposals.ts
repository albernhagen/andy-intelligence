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
  describe(`ConfigChangeStore contract: ${name}`, () => {
    it("GivenAPendingChange_WhenCreatedAndRead_ThenItComesBackEqual", async () => {
      const store = await make();
      const change = pendingConfigChange();

      expect(await store.createPending(change)).toEqual({ created: true, change });
      expect(await store.get(change.id)).toEqual(change);
      expect(await store.get(crypto.randomUUID())).toBeNull();
    });

    it("GivenAPendingChangeWithAKey_WhenAnotherWithTheSameKeyIsCreated_ThenTheFirstComesBack", async () => {
      const store = await make();
      const first = pendingConfigChange({ dedupeKey: "same" });
      await store.createPending(first);

      const again = await store.createPending(pendingConfigChange({ dedupeKey: "same" }));

      expect(again).toEqual({ created: false, change: first });
      expect(await store.list({ limit: 10 })).toHaveLength(1);
    });

    it("GivenARejectedChange_WhenOneWithTheSameKeyIsCreated_ThenItIsStored", async () => {
      const store = await make();
      const first = pendingConfigChange({ dedupeKey: "same" });
      await store.createPending(first);
      await store.reject(first.id, "andy", "2026-11-12T11:00:00.000Z");

      const again = await store.createPending(pendingConfigChange({ dedupeKey: "same" }));

      expect(again.created).toBe(true);
    });

    it("GivenANonPendingChange_WhenCreated_ThenConflict", async () => {
      const store = await make();
      await expect(
        store.createPending(pendingConfigChange({ status: "applied" })),
      ).rejects.toMatchObject({ name: "WorkTrackerError", code: "conflict" });
    });

    it(
      "GivenConcurrentCreatesWithOneKey_WhenRacing_ThenOnlyOneIsStored",
      async () => {
        const store = await make();
        const results = await Promise.all(
          [1, 2, 3].map(() => store.createPending(pendingConfigChange({ dedupeKey: "race" }))),
        );
        expect(results.filter((r) => r.created)).toHaveLength(1);
        expect(await store.list({ limit: 10 })).toHaveLength(1);
      },
      options.raceTimeoutMs,
    );

    it("GivenChanges_WhenListedByProjectAndStatus_ThenOnlyMatchesNewestFirstUpToTheLimit", async () => {
      const store = await make();
      const older = pendingConfigChange({ createdAt: "2026-11-12T09:00:00.000Z" });
      const newer = pendingConfigChange({ createdAt: "2026-11-12T10:00:00.000Z" });
      const other = pendingConfigChange({ projectId: "other" });
      const rejected = pendingConfigChange();
      for (const c of [older, newer, other, rejected]) await store.createPending(c);
      await store.reject(rejected.id, "andy", "2026-11-12T11:00:00.000Z");

      const pending = await store.list({ projectId: "ai", status: "pending", limit: 10 });
      expect(pending.map((c) => c.id)).toEqual([newer.id, older.id]);
      expect(await store.list({ projectId: "ai", status: "pending", limit: 1 })).toEqual([newer]);
      expect(await store.list({ status: "rejected", limit: 10 })).toHaveLength(1);
    });

    it("GivenAPendingChange_WhenRejected_ThenItRecordsWhoAndWhenAndCantBeRejectedAgain", async () => {
      const store = await make();
      const change = pendingConfigChange();
      await store.createPending(change);

      const rejected = await store.reject(change.id, "andy", "2026-11-12T11:00:00.000Z");

      expect(rejected).toMatchObject({
        status: "rejected",
        decidedBy: "andy",
        decidedAt: "2026-11-12T11:00:00.000Z",
        appliedAt: null,
      });
      expect(await store.get(change.id)).toEqual(rejected);
      await expect(
        store.reject(change.id, "andy", "2026-11-12T12:00:00.000Z"),
      ).rejects.toMatchObject({ code: "conflict" });
      await expect(
        store.reject(crypto.randomUUID(), "andy", "2026-11-12T12:00:00.000Z"),
      ).rejects.toMatchObject({ code: "not_found" });
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
