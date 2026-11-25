import type { Firestore } from "@google-cloud/firestore";
import {
  MergeQueueState,
  WorkTrackerError,
  emptyMergeQueue,
  type MergeQueueStore,
} from "@andy/contracts";
import { zodConverter } from "./index";

/**
 * `mergeQueues/{repo}` (AI-110, ADR-0150): one document per repo, keyed by the lower-cased
 * `owner/name` URI-encoded (a document ID can't hold `/`). Server-only, like every collection
 * (the rules deny all client access). A new collection with no queries: no index, nothing to
 * migrate, no SCHEMA_VERSION bump.
 */
export const MERGE_QUEUES_COLLECTION = "mergeQueues";

export const mergeQueueDocId = (repo: string) => encodeURIComponent(repo.toLowerCase());

/** MergeQueueStore on Firestore: a read is one get; a put is one transaction (compare-and-set). */
export class FirestoreMergeQueueStore implements MergeQueueStore {
  constructor(private readonly db: Firestore) {}

  private doc(repo: string) {
    return this.db
      .collection(MERGE_QUEUES_COLLECTION)
      .withConverter(zodConverter(MergeQueueState))
      .doc(mergeQueueDocId(repo));
  }

  async get(repo: string): Promise<MergeQueueState> {
    return (await this.doc(repo).get()).data() ?? emptyMergeQueue(repo);
  }

  async put(next: MergeQueueState, ifVersion: number): Promise<MergeQueueState> {
    const key = next.repo.toLowerCase();
    const ref = this.doc(key);
    return this.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data()?.version ?? 0;
      if (current !== ifVersion) {
        throw new WorkTrackerError(
          "conflict",
          `the merge queue of ${key} changed since it was read`,
        );
      }
      const stored = MergeQueueState.parse({ ...next, repo: key, version: ifVersion + 1 });
      tx.set(ref, stored);
      return stored;
    });
  }
}
