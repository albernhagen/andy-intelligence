import type { Firestore } from "@google-cloud/firestore";
import {
  ConfigChange,
  WorkTrackerError,
  type ConfigChangeFilter,
  type ConfigChangeStore,
} from "@andy/contracts";
import { collections, typedCollection } from "./index";

/**
 * Most documents one list reads before sorting (ADR-0028). Lists use equality filters only, so
 * no composite index is needed, and sort in memory; pending proposals are capped well below.
 */
export const CONFIG_CHANGE_LIST_READ_MAX = 500;

const newestFirst = (a: ConfigChange, b: ConfigChange) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

/**
 * ConfigChangeStore on Firestore (ADR-0097): `configChanges/{id}`. The duplicate check and the
 * reject run inside transactions, so two concurrent proposals with one key can't both land.
 */
export class FirestoreConfigChangeStore implements ConfigChangeStore {
  constructor(private readonly db: Firestore) {}

  private changes() {
    return typedCollection(this.db, collections.configChanges.path(), ConfigChange);
  }

  async createPending(change: ConfigChange): Promise<{ created: boolean; change: ConfigChange }> {
    const parsed = ConfigChange.parse(change);
    if (parsed.status !== "pending") {
      throw new WorkTrackerError("conflict", "only a pending change can be created here");
    }
    return this.db.runTransaction(async (tx) => {
      if (parsed.dedupeKey !== null) {
        const same = await tx.get(
          this.changes()
            .where("dedupeKey", "==", parsed.dedupeKey)
            .where("status", "==", "pending")
            .limit(1),
        );
        const existing = same.docs[0];
        if (existing) return { created: false, change: existing.data() };
      }
      // `create` fails if the id exists, so a reused id can't overwrite a decided change.
      tx.create(this.changes().doc(parsed.id), parsed);
      return { created: true, change: parsed };
    });
  }

  async get(id: string): Promise<ConfigChange | null> {
    const snap = await this.changes().doc(id).get();
    return snap.exists ? (snap.data() ?? null) : null;
  }

  async list(filter: ConfigChangeFilter): Promise<ConfigChange[]> {
    let query = this.changes().limit(CONFIG_CHANGE_LIST_READ_MAX);
    if (filter.projectId !== undefined) query = query.where("projectId", "==", filter.projectId);
    if (filter.status !== undefined) query = query.where("status", "==", filter.status);
    const snap = await query.get();
    return snap.docs
      .map((d) => d.data())
      .sort(newestFirst)
      .slice(0, filter.limit);
  }

  async reject(id: string, by: string, at: string): Promise<ConfigChange> {
    const ref = this.changes().doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data() : undefined;
      if (!current) throw new WorkTrackerError("not_found", `config change ${id} not found`);
      if (current.status !== "pending") {
        throw new WorkTrackerError("conflict", `config change ${id} is ${current.status}`);
      }
      const rejected = ConfigChange.parse({
        ...current,
        status: "rejected",
        decidedBy: by,
        decidedAt: at,
      });
      tx.set(ref, rejected);
      return rejected;
    });
  }
}
