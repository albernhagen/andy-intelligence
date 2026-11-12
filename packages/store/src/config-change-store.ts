import type { Firestore } from "@google-cloud/firestore";
import {
  CONFIG_CHANGE_LIST_MAX,
  ConfigChange,
  WorkTrackerError,
  type ConfigChangeStore,
} from "@andy/contracts";
import { collections, zodConverter } from "./index";

/**
 * A guard on one project's read (ADR-0028). Settings changes are rare (Andy flips a switch), so
 * this is far off; if it is reached the read logs an error, as the newest may be missed.
 */
export const CONFIG_CHANGE_READ_MAX = 1_000;

/**
 * ConfigChangeStore on Firestore: `configChanges/{id}`, server-only (the rules deny every client
 * read and write). `create` refuses an existing id, so an append never overwrites. Queries use
 * equality filters only and sort in memory (no composite index).
 */
export class FirestoreConfigChangeStore implements ConfigChangeStore {
  constructor(private readonly db: Firestore) {}

  private changes() {
    return this.db
      .collection(collections.configChanges.path())
      .withConverter(zodConverter(ConfigChange));
  }

  async append(change: ConfigChange): Promise<ConfigChange> {
    const parsed = ConfigChange.parse(change);
    try {
      await this.changes().doc(parsed.id).create(parsed);
    } catch (err) {
      // gRPC ALREADY_EXISTS (6): the id is taken.
      if ((err as { code?: number }).code === 6) {
        throw new WorkTrackerError("conflict", `config change ${parsed.id} exists`);
      }
      throw err;
    }
    return parsed;
  }

  async get(id: string): Promise<ConfigChange | null> {
    return (await this.changes().doc(id).get()).data() ?? null;
  }

  async listForProject(projectId: string, limit = CONFIG_CHANGE_LIST_MAX): Promise<ConfigChange[]> {
    const snap = await this.changes()
      .where("entity", "==", "project")
      .where("entityId", "==", projectId)
      .limit(CONFIG_CHANGE_READ_MAX)
      .get();
    if (snap.size >= CONFIG_CHANGE_READ_MAX) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          message: "config changes reached the read guard; the newest may be missing",
          component: "config-change-store",
          projectId,
          read: snap.size,
        }),
      );
    }
    return snap.docs
      .map((d) => d.data())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .slice(0, Math.min(limit, CONFIG_CHANGE_LIST_MAX));
  }
}
