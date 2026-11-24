import type { MergeQueueState } from "../entities/merge-queue";

// ── MergeQueueStore ──────────────────────────────────────────────────────────
// The merge queue per repo (AI-110, ADR-0150). One record per repo. Storage only: ordering,
// the lease and the caps live in @andy/domain (`MergeQueue`). A write is a compare-and-set on
// `version`, so two API instances can't both take the lease or both change the queue.

export interface MergeQueueStore {
  /** The repo's queue (any case of `owner/name`); the empty queue, version 0, when none is stored. */
  get(repo: string): Promise<MergeQueueState>;
  /**
   * Stores `next` (its `repo` names the record) only if the stored version is still
   * `ifVersion` (0: nothing stored), stamping `version` to `ifVersion + 1`; returns what was
   * stored. Anything else throws WorkTrackerError `conflict` and writes nothing.
   */
  put(next: MergeQueueState, ifVersion: number): Promise<MergeQueueState>;
}
