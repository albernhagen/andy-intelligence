import type { Milestone, MilestoneInput } from "../entities/milestone";

// ── MilestoneStore ───────────────────────────────────────────────────────────
// A project's milestones (ADR-0131, AI-302: M4.33). Storage only; `MilestoneService` (AI-304:
// M4.34) is its one caller. Reads are bounded by
// MILESTONES_PER_PROJECT_MAX (ADR-0126).

export interface MilestoneStore {
  /** The project's milestones in roadmap order (`byMilestoneOrder`); at most the cap. */
  list(projectId: string): Promise<Milestone[]>;
  /** The milestone, or null. */
  get(projectId: string, id: string): Promise<Milestone | null>;
  /**
   * Stores a new milestone and returns it as stored. An id already in the project throws; one
   * past MILESTONES_PER_PROJECT_MAX throws a MilestoneCapError. Atomic: concurrent creates
   * can't pass the cap.
   */
  create(milestone: MilestoneInput): Promise<Milestone>;
  /**
   * Replaces an existing milestone and returns it as stored; null when there is none. With
   * `ifUpdatedAt` (optimistic concurrency, AI-304), a WorkTrackerError `conflict` when the stored
   * milestone's `updatedAt` differs, and nothing is written. Atomic.
   */
  replace(milestone: MilestoneInput, ifUpdatedAt?: string): Promise<Milestone | null>;
}
