import type { EpicBreakdown } from "../entities/epic-breakdown";

// ── EpicBreakdownStore ───────────────────────────────────────────────────────
// Epic breakdowns (AI-383, ADR-0155): one per top-level epic, keyed by the epic's id. Storage
// only; `EpicBreakdownService` is its one caller. Kept apart from the ticket so a proposal of up
// to 12 drafted tickets isn't copied into the ticket's history on every status change.

/** Breakdowns `listWaiting` returns per project at most (ADR-0028). */
export const WAITING_BREAKDOWNS_MAX = 50;

export interface EpicBreakdownStore {
  /** The epic's breakdown, or null. */
  get(projectId: string, epicId: string): Promise<EpicBreakdown | null>;
  /**
   * Writes the breakdown and returns it as stored. `ifUpdatedAt` null: only when the epic has
   * none yet; a string: only when the stored one's `updatedAt` matches. Otherwise a
   * WorkTrackerError `conflict`, and nothing is written. Atomic.
   */
  put(breakdown: EpicBreakdown, ifUpdatedAt: string | null): Promise<EpicBreakdown>;
  /** The project's breakdowns that wait for Andy (`proposed` or `approving`); at most the cap. */
  listWaiting(projectId: string): Promise<EpicBreakdown[]>;
}
