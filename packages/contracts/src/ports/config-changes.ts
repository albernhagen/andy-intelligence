import type { ConfigChange } from "../entities";

// ── ConfigChangeLog ──────────────────────────────────────────────────────────
// The applied side of ConfigChangeStore (`config-proposals.ts` holds the pending side, ADR-0097):
// every project-settings write appends an `applied` change (M4.11: Config change log). M4.12
// reverts one: the settings go back through the normal write (logged as a new change) and the
// original is marked `reverted`. A project's changes are `entity: "project"`, `entityId` and `projectId` the project id.
// A project's routing changes (AI-239) are `entity: "routing"` with the same `entityId`; global ones `entityId: "global"`.
// Errors are WorkTrackerError (`conflict`), mapped the same way by the API.

/** At most this many changes per `listForProject` call (ADR-0028). */
export const CONFIG_CHANGE_LIST_MAX = 100;

export interface ConfigChangeLog {
  /** Stores the change; a duplicate id is a `conflict` and nothing is written. */
  append(change: ConfigChange): Promise<ConfigChange>;
  get(id: string): Promise<ConfigChange | null>;
  /**
   * The project's settings and routing changes, newest first, at most `limit` (capped at
   * CONFIG_CHANGE_LIST_MAX).
   */
  listForProject(projectId: string, limit?: number): Promise<ConfigChange[]>;
  /**
   * Applied → reverted, recording who (`decidedBy`, an actor such as `user:<uid>`) and when
   * (`decidedAt`), atomically (M4.12). `conflict` unless applied, `not_found` when unknown.
   */
  markReverted(id: string, by: string, at: string): Promise<ConfigChange>;
}
