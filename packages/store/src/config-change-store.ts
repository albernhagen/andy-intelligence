import type { Firestore } from "@google-cloud/firestore";
import {
  ConfigChange,
  ProposalLookupCursor,
  WorkTrackerError,
  type ConfigChangeDecision,
  type ConfigChangeStore,
  type CreatePendingOutcome,
} from "@andy/contracts";
import { collections, typedCollection } from "./index";

/**
 * A guard on one pending read (ADR-0028). Pending changes are capped per project on write, so
 * this is never reached in practice; if it is, the read logs an error rather than hiding it.
 */
export const CONFIG_CHANGE_PENDING_READ_MAX = 1_000;

const newestFirst = (a: ConfigChange, b: ConfigChange) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

/**
 * ConfigChangeStore on Firestore (ADR-0097): `configChanges/{id}`. The duplicate check, the
 * pending cap and decisions run inside transactions (serializable, queries included), so
 * concurrent proposals can't both pass. Queries use equality filters only: no composite index.
 * Each project's lookup cursor (AI-137) is one document in `proposalLookupCursors/{projectId}`.
 */
export class FirestoreConfigChangeStore implements ConfigChangeStore {
  constructor(private readonly db: Firestore) {}

  private changes() {
    return typedCollection(this.db, collections.configChanges.path(), ConfigChange);
  }

  async createPending(change: ConfigChange, maxPending: number): Promise<CreatePendingOutcome> {
    const parsed = ConfigChange.parse(change);
    if (parsed.status !== "pending") {
      throw new WorkTrackerError("conflict", "only a pending change can be created here");
    }
    return this.db.runTransaction(async (tx): Promise<CreatePendingOutcome> => {
      const pending = (
        await tx.get(
          this.changes()
            .where("projectId", "==", parsed.projectId)
            .where("status", "==", "pending")
            .limit(CONFIG_CHANGE_PENDING_READ_MAX),
        )
      ).docs.map((d) => d.data());
      const same =
        parsed.dedupeKey === null
          ? undefined
          : pending.find((c) => c.dedupeKey === parsed.dedupeKey);
      if (same) return { outcome: "duplicate", change: same };
      if (pending.length >= maxPending) return { outcome: "capped", change: null };
      // `create` fails if the id exists, so a reused id can't overwrite a decided change.
      tx.create(this.changes().doc(parsed.id), parsed);
      return { outcome: "created", change: parsed };
    });
  }

  async get(id: string): Promise<ConfigChange | null> {
    const snap = await this.changes().doc(id).get();
    return snap.exists ? (snap.data() ?? null) : null;
  }

  async listPending(projectId?: string): Promise<ConfigChange[]> {
    let query = this.changes().where("status", "==", "pending");
    if (projectId !== undefined) query = query.where("projectId", "==", projectId);
    const snap = await query.limit(CONFIG_CHANGE_PENDING_READ_MAX).get();
    if (snap.size >= CONFIG_CHANGE_PENDING_READ_MAX) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          message: "pending config changes reached the read guard; the list may be incomplete",
          component: "config-change-store",
          projectId: projectId ?? null,
          read: snap.size,
        }),
      );
    }
    return snap.docs.map((d) => d.data()).sort(newestFirst);
  }

  async latestDecision(dedupeKey: string): Promise<ConfigChange | null> {
    // One key's history: a change per proposal, each decided once, so small; sorted in memory.
    const snap = await this.changes().where("dedupeKey", "==", dedupeKey).get();
    const decided = snap.docs.map((d) => d.data()).filter((c) => c.decidedAt !== null);
    decided.sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
    return decided[0] ?? null;
  }

  private cursors() {
    return typedCollection(this.db, collections.proposalLookupCursors.path(), ProposalLookupCursor);
  }

  /** One document read: `proposalLookupCursors/{projectId}`. */
  async getLookupCursor(projectId: string): Promise<ProposalLookupCursor | null> {
    const snap = await this.cursors().doc(projectId).get();
    return snap.exists ? (snap.data() ?? null) : null;
  }

  async setLookupCursor(cursor: ProposalLookupCursor): Promise<void> {
    const parsed = ProposalLookupCursor.parse(cursor);
    await this.cursors().doc(parsed.projectId).set(parsed);
  }

  async decide(
    id: string,
    decision: ConfigChangeDecision,
    by: string,
    at: string,
  ): Promise<ConfigChange> {
    const ref = this.changes().doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data() : undefined;
      if (!current) throw new WorkTrackerError("not_found", `config change ${id} not found`);
      if (current.status !== "pending") {
        throw new WorkTrackerError("conflict", `config change ${id} is ${current.status}`);
      }
      const decided = ConfigChange.parse({
        ...current,
        status: decision,
        decidedBy: by,
        decidedAt: at,
      });
      tx.set(ref, decided);
      return decided;
    });
  }
}
