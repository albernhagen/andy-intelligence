import type { ConfigChange } from "../entities";
import { eventId } from "./work-tracker-support";

// ── ConfigChangeLog ──────────────────────────────────────────────────────────
// The applied side of ConfigChangeStore (`config-proposals.ts` holds the pending side, ADR-0097):
// every project-settings write appends an `applied` change (M4.11: Config change log). M4.12
// reverts one: the settings go back through the normal write (logged as a new change) and the
// original is marked `reverted`. A project's changes are `entity: "project"`, `entityId` and `projectId` the project id.
// A project's routing changes (AI-239) are `entity: "routing"` with the same `entityId`. A global
// change (no project: global routing, later global spend caps) has `entityId: GLOBAL_ENTITY_ID`
// and `projectId: null`; `listGlobal` reads them by entity (AI-275).
// Errors are WorkTrackerError (`conflict`), mapped the same way by the API.

/**
 * A new change's id (AI-349): sorts in write order, like ticket event ids (zero-padded epoch ms,
 * a per-process sequence within one millisecond, a random suffix). Lists are newest first by
 * `createdAt`, then by id descending, so two changes saved in the same millisecond come back
 * newest first.
 */
export function configChangeId(at: Date = new Date()): string {
  return eventId(at);
}

/** At most this many changes per `listForProject` or `listGlobal` call (ADR-0028). */
export const CONFIG_CHANGE_LIST_MAX = 100;

/** The `entityId` of a change to something global, not a project's (AI-275). */
export const GLOBAL_ENTITY_ID = "global";

export interface ConfigChangeLog {
  /** Stores the change; a duplicate id is a `conflict` and nothing is written. */
  append(change: ConfigChange): Promise<ConfigChange>;
  get(id: string): Promise<ConfigChange | null>;
  /**
   * The project's settings and routing changes (`entityId` is the project) and its milestone
   * changes (entity `milestone`, `projectId` is the project, AI-304), newest first (ties: id
   * descending, see configChangeId), at most
   * `limit` (capped at CONFIG_CHANGE_LIST_MAX).
   */
  listForProject(projectId: string, limit?: number): Promise<ConfigChange[]>;
  /**
   * The global changes of one entity (e.g. `routing`), newest first, at most `limit` (capped at
   * CONFIG_CHANGE_LIST_MAX). Global: `entityId` is GLOBAL_ENTITY_ID (AI-275).
   */
  listGlobal(entity: string, limit?: number): Promise<ConfigChange[]>;
  /**
   * Applied → reverted, recording who (`decidedBy`, an actor such as `user:<uid>`) and when
   * (`decidedAt`), atomically (M4.12). `conflict` unless applied, `not_found` when unknown.
   */
  markReverted(id: string, by: string, at: string): Promise<ConfigChange>;
}
