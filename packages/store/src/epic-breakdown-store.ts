import type { Firestore } from "@google-cloud/firestore";
import {
  EpicBreakdown,
  WAITING_BREAKDOWNS_MAX,
  WorkTrackerError,
  type EpicBreakdownStore,
} from "@andy/contracts";
import { collections, typedCollection } from "./index";

/**
 * EpicBreakdownStore on Firestore (AI-383, ADR-0155), server-only (no client reads or writes):
 * `projects/{projectId}/epicBreakdowns/{epicId}`. `put` checks the stamp inside a transaction.
 * `listWaiting` is one `in` query on `status` (a single-field index Firestore keeps by default),
 * capped at WAITING_BREAKDOWNS_MAX. Nothing here logs.
 */
export class FirestoreEpicBreakdownStore implements EpicBreakdownStore {
  constructor(private readonly db: Firestore) {}

  private coll(projectId: string) {
    return typedCollection(this.db, collections.epicBreakdowns.path(projectId), EpicBreakdown);
  }

  async get(projectId: string, epicId: string): Promise<EpicBreakdown | null> {
    return (await this.coll(projectId).doc(epicId).get()).data() ?? null;
  }

  async put(breakdown: EpicBreakdown, ifUpdatedAt: string | null): Promise<EpicBreakdown> {
    const b = EpicBreakdown.parse(breakdown);
    const ref = this.coll(b.projectId).doc(b.epicId);
    return this.db.runTransaction(async (tx) => {
      const stored = (await tx.get(ref)).data();
      if ((stored?.updatedAt ?? null) !== ifUpdatedAt) {
        throw new WorkTrackerError(
          "conflict",
          `epic ${b.epicId}'s breakdown changed since it was read`,
        );
      }
      tx.set(ref, b);
      return b;
    });
  }

  async listWaiting(projectId: string): Promise<EpicBreakdown[]> {
    const snap = await this.coll(projectId)
      .where("status", "in", ["proposed", "approving"])
      .limit(WAITING_BREAKDOWNS_MAX)
      .get();
    return snap.docs.map((d) => d.data());
  }
}
