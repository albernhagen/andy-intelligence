import { z } from "zod";

/** How much a bad change could break (`platform/procedures/refine.md` has the rubric). */
export const Risk = z.enum(["low", "medium", "high"]);
export type Risk = z.infer<typeof Risk>;

/** How sure refine is that the ticket is understood and the plan is safe. */
export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

/** Cap on each one-line reason (ADR-0028): refine writes them, so they are untrusted agent text. */
export const SCORE_REASON_MAX = 300;

const reason = z.string().trim().min(1).max(SCORE_REASON_MAX);

/** On the ticket. Optional, never part of the Definition of Ready; defaults keep older documents readable. */
export const TicketScores = {
  risk: Risk.nullable().default(null),
  riskReason: reason.nullable().default(null),
  confidence: Confidence.nullable().default(null),
  confidenceReason: reason.nullable().default(null),
};

/** The same fields for a partial write: Zod 4 would turn a default into "reset" inside `.partial()`. */
export const TicketScoreFields = {
  risk: Risk.nullable().optional(),
  riskReason: reason.nullable().optional(),
  confidence: Confidence.nullable().optional(),
  confidenceReason: reason.nullable().optional(),
};

/** What a refine run returns besides size; `refine.schema.json` is the agent's copy. */
export const RefineScores = {
  risk: Risk,
  riskReason: reason,
  confidence: Confidence,
  confidenceReason: reason,
};
