import { z } from "zod";
import { Id, Size, Timestamp } from "./common";
import { ProjectPlanStatus } from "./project-plan";
import { siblingDependencyIssues } from "./sibling-dependencies";

/** An `EventActor` (defined in ./index, which imports this file); set only by the domain. */
const Actor = z.string().min(1).max(200);

/**
 * An epic breakdown (AI-383, ADR-0155): the plan-epic procedure's result for one top-level epic,
 * stored as a proposal until Andy decides it. Approved, each drafted ticket becomes a child of the
 * epic in Ideas, in order; nothing builds. `platform/procedures/plan-epic.schema.json` is the
 * agent's copy of EpicBreakdownProposal; this schema is the check. All text is untrusted agent
 * output, so every field is capped (ADR-0028).
 */

export const BREAKDOWN_LIMITS = {
  /** Tickets one proposal may hold; a bigger epic is cut into child epics instead. */
  tickets: 12,
  /** Drafting tasks one epic may run in all, whatever their outcome. */
  draftsPerEpic: 3,
  summary: 4000,
  title: 200,
  body: 2000,
  criteria: 10,
  criterion: 500,
  sizeReason: 300,
  touches: 20,
  touch: 300,
  reason: 2000,
} as const;

const capped = (max: number) => z.string().trim().min(1).max(max);

/** The ticket types a breakdown may draft: never an epic. */
export const DraftedTicketType = z.enum(["feature", "chore", "bug", "spike"]);
export type DraftedTicketType = z.infer<typeof DraftedTicketType>;

/** One drafted child ticket. `blockedBy` holds 0-based indexes of sibling drafted tickets. */
export const DraftedTicket = z.strictObject({
  title: capped(BREAKDOWN_LIMITS.title),
  type: DraftedTicketType,
  size: Size,
  sizeReason: capped(BREAKDOWN_LIMITS.sizeReason),
  body: capped(BREAKDOWN_LIMITS.body),
  acceptanceCriteria: z
    .array(capped(BREAKDOWN_LIMITS.criterion))
    .min(1)
    .max(BREAKDOWN_LIMITS.criteria),
  touches: z.array(capped(BREAKDOWN_LIMITS.touch)).max(BREAKDOWN_LIMITS.touches),
  blockedBy: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(BREAKDOWN_LIMITS.tickets - 1),
    )
    .max(BREAKDOWN_LIMITS.tickets - 1),
});
export type DraftedTicket = z.infer<typeof DraftedTicket>;

export const EpicBreakdownProposal = z
  .strictObject({
    summary: capped(BREAKDOWN_LIMITS.summary),
    tickets: z.array(DraftedTicket).min(1).max(BREAKDOWN_LIMITS.tickets),
  })
  .superRefine((p, ctx) => {
    for (const message of siblingDependencyIssues(p.tickets)) {
      ctx.addIssue({ code: "custom", path: ["tickets"], message });
    }
  });
export type EpicBreakdownProposal = z.infer<typeof EpicBreakdownProposal>;

/** Same lifecycle as a project plan: `approving` while tickets are created, resumable. */
export const EpicBreakdownStatus = ProjectPlanStatus;
export type EpicBreakdownStatus = z.infer<typeof EpicBreakdownStatus>;

export const EpicBreakdown = z.object({
  projectId: Id,
  /** The top-level epic it breaks down; also its document id. */
  epicId: Id,
  status: EpicBreakdownStatus,
  proposal: EpicBreakdownProposal,
  proposedBy: Actor,
  proposedAt: Timestamp,
  decidedBy: Actor.nullable(),
  decidedAt: Timestamp.nullable(),
  /** Andy's note when he sent it back; the next drafting task reads it. */
  reason: z.string().max(BREAKDOWN_LIMITS.reason).nullable(),
  /** The tickets approval created, in proposal order. */
  ticketIds: z.array(Id).max(BREAKDOWN_LIMITS.tickets),
  /** Optimistic concurrency stamp for the store. */
  updatedAt: Timestamp,
});
export type EpicBreakdown = z.infer<typeof EpicBreakdown>;

/** Andy's decision: approve, or send back with a note. */
export const EpicBreakdownDecision = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approved") }),
  z.object({
    decision: z.literal("rejected"),
    reason: z.string().trim().min(1).max(BREAKDOWN_LIMITS.reason),
  }),
]);
export type EpicBreakdownDecision = z.infer<typeof EpicBreakdownDecision>;

/** A breakdown waiting for Andy, with what the Needs-you inbox shows about its epic. */
export const WaitingEpicBreakdown = z.object({
  projectId: Id,
  projectKey: z.string(),
  epicId: Id,
  epicKey: z.string(),
  epicTitle: z.string(),
  breakdown: EpicBreakdown,
});
export type WaitingEpicBreakdown = z.infer<typeof WaitingEpicBreakdown>;
