import { MergeQueueState, emptyMergeQueue } from "../entities/merge-queue";
import { WorkTrackerError } from "../ports";
import type { MergeQueueStore } from "../ports/merge-queue";

/**
 * In-memory MergeQueueStore. Each method reads and writes without an await in between, so
 * concurrent puts are atomic in one process, like the real store's transaction.
 */
export class InMemoryMergeQueueStore implements MergeQueueStore {
  private readonly queues = new Map<string, MergeQueueState>();

  async get(repo: string): Promise<MergeQueueState> {
    const key = repo.toLowerCase();
    return structuredClone(this.queues.get(key) ?? emptyMergeQueue(key));
  }

  async put(next: MergeQueueState, ifVersion: number): Promise<MergeQueueState> {
    const key = next.repo.toLowerCase();
    const current = this.queues.get(key)?.version ?? 0;
    if (current !== ifVersion) {
      throw new WorkTrackerError("conflict", `the merge queue of ${key} changed since it was read`);
    }
    const stored = MergeQueueState.parse({ ...next, repo: key, version: ifVersion + 1 });
    this.queues.set(key, stored);
    return structuredClone(stored);
  }
}
