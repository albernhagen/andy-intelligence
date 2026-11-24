import { z } from "zod";
import { Id, Timestamp } from "./common";

/**
 * Milestones (ADR-0131, AI-302: M4.33): a project's ordered groups of epics. Storage shapes only:
 * nothing reads a milestone yet; the API and MCP (AI-304: M4.34), the roadmap and dispatch follow.
 */

/** Stored status. "Done" is computed (an approved milestone whose epics are all Done), never stored. */
export const MilestoneStatus = z.enum(["not_reviewed", "approved", "parked"]);
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;

/** Milestones one project may hold (ADR-0028). */
export const MILESTONES_PER_PROJECT_MAX = 50;
/** Longest milestone outcome: one line, like an epic's (ADR-0131). */
export const MILESTONE_OUTCOME_MAX = 300;
/** Longest milestone name. */
export const MILESTONE_NAME_MAX = 120;

/** Longest line in a milestone's case (ADR-0149). */
export const MILESTONE_CASE_LINE_MAX = 300;

const CaseLine = z.string().trim().min(1).max(MILESTONE_CASE_LINE_MAX);

/**
 * A milestone's case (ADR-0149, AI-365): why it is worth building, shown where Andy approves or
 * parks it. Written by the plan-project agent task or by Andy. Effort is not stored: the roadmap
 * derives it from the milestone's tickets. All text is untrusted data.
 */
export const MilestoneCase = z.strictObject({
  /** Who it serves: the people or system that gain from it. */
  serves: CaseLine,
  /** What they gain, and how Andy will know. */
  expectedReturn: CaseLine,
  /** The cheapest way to test it is worth building, before building all of it. */
  cheapestTest: CaseLine,
});
export type MilestoneCase = z.infer<typeof MilestoneCase>;

/** A milestone id: also a storage path segment, so a fixed charset and no `/`. */
export const MilestoneId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid milestone id");

export const Milestone = z.object({
  id: MilestoneId,
  projectId: Id.regex(/^[^/]+$/),
  name: z.string().trim().min(1).max(MILESTONE_NAME_MAX),
  /** What is true when it is done, one line. */
  outcome: z.string().trim().min(1).max(MILESTONE_OUTCOME_MAX),
  /** Position on the roadmap: lower first. Ties sort by name. */
  order: z.number().int().min(0).max(10_000),
  /** New milestones start `not_reviewed`. */
  status: MilestoneStatus.default("not_reviewed"),
  /** Why it is worth building (ADR-0149); absent on milestones made before it or without one. */
  case: MilestoneCase.optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Milestone = z.infer<typeof Milestone>;
/** What callers pass to `create` and `replace`: `status` may be left out on a new one. */
export type MilestoneInput = z.input<typeof Milestone>;

/** Refused because the project already holds MILESTONES_PER_PROJECT_MAX milestones (ADR-0028). */
export class MilestoneCapError extends Error {
  readonly cap = "MILESTONES_PER_PROJECT_MAX";
  constructor(limit: number = MILESTONES_PER_PROJECT_MAX) {
    super(`project already has ${limit} milestones (MILESTONES_PER_PROJECT_MAX)`);
    this.name = "MilestoneCapError";
  }
}

/** The roadmap's order: by `order`, then name, then id (stable). */
export const byMilestoneOrder = (a: Milestone, b: Milestone) =>
  a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * Why `ticket` can't hold a milestone, or null when it can: only a top-level epic does; a child
 * epic and every ticket take their top-level epic's (`milestoneOf` in `@andy/domain`). Every
 * ticket write checks it (`applyTicketChange`), so a type or parent change can't leave one behind.
 */
export function milestoneTargetProblem(ticket: {
  key: string;
  type: string | null;
  parentId: string | null;
}): string | null {
  if (ticket.type !== "epic") {
    return `only a top-level epic has a milestone; ${ticket.key} is ${ticket.type ? `a ${ticket.type}` : "untyped"} and takes its epic's`;
  }
  if (ticket.parentId) {
    return `only a top-level epic has a milestone; ${ticket.key} is a child epic and takes its top-level epic's`;
  }
  return null;
}
