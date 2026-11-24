import { describe, expect, it } from "vitest";
import type { MergeQueueEntry, MergeQueueState } from "../entities/merge-queue";
import type { MergeQueueStore } from "../ports/merge-queue";

/** `make` must return an empty store. */
export function mergeQueueStoreContract(name: string, make: () => Promise<MergeQueueStore>): void {
  describe(`MergeQueueStore contract: ${name}`, () => {
    const entry = (number: number): MergeQueueEntry => ({
      projectId: "ai",
      number,
      kind: "gate",
      enqueuedAt: "2026-11-23T10:00:00.000Z",
      enqueuedBy: "system",
      headSha: "a".repeat(40),
      syncs: 0,
      syncRequestedSha: null,
      headSince: null,
    });
    const state = (repo: string, entries: MergeQueueEntry[], version: number): MergeQueueState => ({
      repo,
      entries,
      lease: { holder: "i1", until: "2026-11-23T10:01:00.000Z" },
      version,
    });
    const isConflict = (err: unknown) => (err as { code?: string }).code === "conflict";

    it("GivenNothingStored_WhenRead_ThenTheEmptyQueueAtVersion0", async () => {
      expect(await (await make()).get("Owner/Repo")).toEqual({
        repo: "owner/repo",
        entries: [],
        lease: null,
        version: 0,
      });
    });

    it("GivenNothingStored_WhenPutWithVersion0_ThenStoredAtVersion1AndReadInAnyCase", async () => {
      const store = await make();
      const saved = await store.put(state("owner/repo", [entry(1)], 0), 0);
      expect(saved.version).toBe(1);
      expect(await store.get("OWNER/repo")).toEqual(saved);
    });

    it("GivenAStoredQueue_WhenPutWithAStaleVersion_ThenConflictAndNothingWritten", async () => {
      const store = await make();
      const first = await store.put(state("owner/repo", [entry(1)], 0), 0);
      await store.put({ ...first, entries: [entry(1), entry(2)] }, first.version);
      const stale = store.put({ ...first, entries: [] }, first.version);
      await expect(stale).rejects.toSatisfy(isConflict);
      expect((await store.get("owner/repo")).entries.map((e) => e.number)).toEqual([1, 2]);
    });

    it("GivenTwoWritersOnOneVersion_WhenBothPut_ThenExactlyOneWins", async () => {
      const store = await make();
      const base = await store.get("owner/race");
      const results = await Promise.allSettled([
        store.put(state("owner/race", [entry(1)], 0), base.version),
        store.put(state("owner/race", [entry(2)], 0), base.version),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(isConflict(lost.reason)).toBe(true);
    });

    it("GivenTwoRepos_WhenEachPut_ThenTheyDoNotShareARecord", async () => {
      const store = await make();
      await store.put(state("owner/a", [entry(1)], 0), 0);
      await store.put(state("owner/b", [entry(2)], 0), 0);
      expect((await store.get("owner/a")).entries.map((e) => e.number)).toEqual([1]);
      expect((await store.get("owner/b")).entries.map((e) => e.number)).toEqual([2]);
    });
  });
}
