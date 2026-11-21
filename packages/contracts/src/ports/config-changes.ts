import type { ConfigChange } from "../entities";

// ── ConfigChangeLog ──────────────────────────────────────────────────────────
// The applied side of ConfigChangeStore (`config-proposals.ts` holds the pending side, ADR-0097):
// every project-settings write appends an `applied` change (M4.11: Config change log). Revert is
// M4.12. A project's changes are `entity: "project"`, `entityId` and `projectId` the project id.
// Errors are WorkTrackerError (`conflict`), mapped the same way by the API.

/** At most this many changes per `listForProject` call (ADR-0028). */
export const CONFIG_CHANGE_LIST_MAX = 100;

export interface ConfigChangeLog {
  /** Stores the change; a duplicate id is a `conflict` and nothing is written. */
  append(change: ConfigChange): Promise<ConfigChange>;
  get(id: string): Promise<ConfigChange | null>;
  /** The project's changes, newest first, at most `limit` (capped at CONFIG_CHANGE_LIST_MAX). */
  listForProject(projectId: string, limit?: number): Promise<ConfigChange[]>;
}
