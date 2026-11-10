import type { Firestore } from "@google-cloud/firestore";
import {
  ACTIVE_RUN_STATUSES,
  applyRunPatch,
  buildRun,
  newestFirst,
  notFound,
  type NewRun,
  type Run,
  type RunPatch,
  type RunStatus,
  type RunStore,
} from "@andy/contracts";
import { collections, typedCollection } from "./index";

/**
 * RunStore on Firestore: one document per run in `runs`. Status changes run in a transaction,
 * so the status check and the write are atomic. Equality filters only (no composite indexes);
 * sorting happens in memory.
 */
export class FirestoreRunStore implements RunStore {
  constructor(
    private readonly db: Firestore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private runs() {
    return typedCollection(this.db, collections.runs.path(), collections.runs.schema);
  }

  async create(input: NewRun): Promise<Run> {
    const ref = this.runs().doc();
    const run = buildRun(input, ref.id, this.now());
    await ref.create(run);
    return run;
  }

  async get(runId: string): Promise<Run | null> {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(runId)) return null;
    return (await this.runs().doc(runId).get()).data() ?? null;
  }

  async listForTicket(projectId: string, ticketId: string): Promise<Run[]> {
    const snap = await this.runs()
      .where("projectId", "==", projectId)
      .where("ticketId", "==", ticketId)
      .get();
    return snap.docs.map((d) => d.data()).sort(newestFirst);
  }

  async listActive(projectId: string): Promise<Run[]> {
    // One equality query per status: equality-only filters need no composite index.
    const snaps = await Promise.all(
      ACTIVE_RUN_STATUSES.map((status) =>
        this.runs().where("projectId", "==", projectId).where("status", "==", status).get(),
      ),
    );
    return snaps.flatMap((s) => s.docs.map((d) => d.data())).sort(newestFirst);
  }

  async listEndedBetween(projectId: string, from: string, to: string, limit: number) {
    // Bounded in the query: at most `limit` documents, newest first, on `endedAt`'s automatic
    // single-field index. The project filter runs in memory because an equality plus a range
    // would need a composite index (a Terraform change); other projects' runs count toward the
    // cap, and `complete` says when it was reached (AI-70, ADR-0081).
    const snap = await this.runs()
      .where("endedAt", ">=", from)
      .where("endedAt", "<=", to)
      .orderBy("endedAt", "desc")
      .limit(limit)
      .get();
    const runs = snap.docs.map((d) => d.data()).filter((r) => r.projectId === projectId);
    return { runs, complete: snap.size < limit };
  }

  async update(runId: string, patch: RunPatch, from: readonly RunStatus[]): Promise<Run> {
    const ref = this.runs().doc(runId);
    return this.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (!current) throw notFound("run", runId);
      const run = applyRunPatch(current, patch, from);
      tx.set(ref, run);
      return run;
    });
  }
}
