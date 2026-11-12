import { z } from "zod";
import { Id, Timestamp } from "./common";

/** An `EventActor` (defined in ./index, which imports this file); set only by the domain. */
const Actor = z.string().min(1).max(200);

/**
 * A project plan (AI-108, AI-65: Project planning baked into the flow): the plan-project
 * procedure's result, stored on the project as a proposal until Andy decides it. Approved, each
 * milestone becomes an epic, in order (ADR-0060). `platform/procedures/plan-project.schema.json`
 * is the agent's copy of ProjectPlanProposal; this schema is the check. All text is untrusted.
 */

export const PLAN_LIMITS = {
  summary: 4000,
  milestones: 10,
  title: 60,
  goal: 300,
  doneWhen: 5,
  slices: 10,
  item: 200,
  reason: 2000,
} as const;

const Line = z.string().trim().min(1).max(PLAN_LIMITS.item);

export const PlannedMilestone = z.object({
  title: z.string().trim().min(1).max(PLAN_LIMITS.title),
  goal: z.string().trim().min(1).max(PLAN_LIMITS.goal),
  doneWhen: z.array(Line).min(1).max(PLAN_LIMITS.doneWhen),
  slices: z.array(Line).min(1).max(PLAN_LIMITS.slices),
});
export type PlannedMilestone = z.infer<typeof PlannedMilestone>;

export const ProjectPlanProposal = z.strictObject({
  summary: z.string().trim().min(1).max(PLAN_LIMITS.summary),
  milestones: z.array(PlannedMilestone).min(1).max(PLAN_LIMITS.milestones),
});
export type ProjectPlanProposal = z.infer<typeof ProjectPlanProposal>;

export const ProjectPlanStatus = z.enum(["proposed", "approved", "rejected"]);
export type ProjectPlanStatus = z.infer<typeof ProjectPlanStatus>;

export const ProjectPlan = z.object({
  status: ProjectPlanStatus,
  proposal: ProjectPlanProposal,
  proposedBy: Actor,
  proposedAt: Timestamp,
  decidedBy: Actor.nullable(),
  decidedAt: Timestamp.nullable(),
  /** Andy's reason for a rejection. */
  reason: z.string().max(PLAN_LIMITS.reason).nullable(),
  /** The epics approval created, in milestone order. */
  epicIds: z.array(Id).max(PLAN_LIMITS.milestones),
});
export type ProjectPlan = z.infer<typeof ProjectPlan>;

/** Andy's decision on a proposed plan; a rejection needs a reason. */
export const ProjectPlanDecision = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approved") }),
  z.object({
    decision: z.literal("rejected"),
    reason: z.string().trim().min(1).max(PLAN_LIMITS.reason),
  }),
]);
export type ProjectPlanDecision = z.infer<typeof ProjectPlanDecision>;

/** Spread into `Project`: null until a plan is proposed. */
export const projectPlanFields = {
  projectPlan: ProjectPlan.nullable().default(null),
};

/** Spread into `ProjectPatch` (storage only; never in ProjectSettings, so no caller sets it). */
export const projectPlanPatch = {
  projectPlan: ProjectPlan.nullable().optional(),
};
