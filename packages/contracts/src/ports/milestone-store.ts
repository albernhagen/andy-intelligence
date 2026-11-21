import type { Milestone, MilestoneInput } from "../entities/milestone";

// ── MilestoneStore ───────────────────────────────────────────────────────────
// A project's milestones (ADR-0131, AI-302: M4.33). Storage only: nothing reads it yet
// (AI-304: M4.34 adds the domain service, API and MCP). Reads are bounded by
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
  /** Replaces an existing milestone and returns it as stored; null when there is none. */
  replace(milestone: MilestoneInput): Promise<Milestone | null>;
}
