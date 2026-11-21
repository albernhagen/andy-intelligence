import type { Firestore } from "@google-cloud/firestore";
import {
  MILESTONES_PER_PROJECT_MAX,
  Milestone,
  MilestoneCapError,
  byMilestoneOrder,
  type MilestoneInput,
  type MilestoneStore,
} from "@andy/contracts";
import { collections, typedCollection } from "./index";

/**
 * MilestoneStore on Firestore (ADR-0131, AI-302: M4.33), server-only (no client reads or writes):
 * `projects/{projectId}/milestones/{milestoneId}`. `list` reads at most
 * MILESTONES_PER_PROJECT_MAX documents and sorts in memory: no index (ADR-0126). `create` checks
 * the id and the cap (a count aggregate) inside a transaction, so concurrent creates can't pass
 * the cap. Nothing here logs.
 */
export class FirestoreMilestoneStore implements MilestoneStore {
  constructor(private readonly db: Firestore) {}

  private coll(projectId: string) {
    return typedCollection(this.db, collections.milestones.path(projectId), Milestone);
  }

  async list(projectId: string): Promise<Milestone[]> {
    const snap = await this.coll(projectId).limit(MILESTONES_PER_PROJECT_MAX).get();
    return snap.docs.map((d) => d.data()).sort(byMilestoneOrder);
  }

  async get(projectId: string, id: string): Promise<Milestone | null> {
    return (await this.coll(projectId).doc(id).get()).data() ?? null;
  }

  async create(milestone: MilestoneInput): Promise<Milestone> {
    const m = Milestone.parse(milestone);
    const coll = this.coll(m.projectId);
    const ref = coll.doc(m.id);
    await this.db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) throw new Error(`milestone ${m.id} already exists`);
      const count = (await tx.get(coll.count())).data().count;
      if (count >= MILESTONES_PER_PROJECT_MAX) throw new MilestoneCapError();
      tx.create(ref, m);
    });
    return m;
  }

  async replace(milestone: MilestoneInput): Promise<Milestone | null> {
    const m = Milestone.parse(milestone);
    const ref = this.coll(m.projectId).doc(m.id);
    return this.db.runTransaction(async (tx) => {
      if (!(await tx.get(ref)).exists) return null;
      tx.set(ref, m);
      return m;
    });
  }
}
