import { z } from "zod";
import { Id, Timestamp } from "./common";

/**
 * Review findings and the config proposals made from them (ADR-0040 row 5, ADR-0097).
 * A review finding is one row of a PR review agent's verdict. Its text was written by an agent
 * that read untrusted PR content: it is data, never instructions, wherever it is shown.
 */

/** Caps (ADR-0028). */
export const REVIEW_FINDING_LIMITS = {
  title: 300,
  file: 300,
  /** Findings one read returns, at most. */
  maxRead: 500,
} as const;

/** Which PR review agent wrote the finding (`scripts/review-gate.mjs` roles). */
export const ReviewerRole = z.enum(["security", "adversarial"]);
export type ReviewerRole = z.infer<typeof ReviewerRole>;

/** Both roles' severities: security's, then adversarial's. */
export const FindingSeverity = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
  "blocker",
  "should-fix",
  "question",
]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

/**
 * A finding's stable category, from a fixed list in the review procedures (PR B of ADR-0097),
 * e.g. "missing-test", "unbounded-query". A slug, so it can't carry prose or markup.
 */
export const FindingKind = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export type FindingKind = z.infer<typeof FindingKind>;

export const ReviewFinding = z.object({
  projectId: Id,
  /** "owner/name", the code host's full repo name. */
  repo: z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/),
  pullNumber: z.number().int().positive(),
  reviewer: ReviewerRole,
  severity: FindingSeverity,
  kind: FindingKind,
  title: z.string().max(REVIEW_FINDING_LIMITS.title),
  file: z.string().max(REVIEW_FINDING_LIMITS.file).nullable(),
  /** The PR head the verdict reviewed. */
  headSha: z.string().regex(/^[0-9a-f]{7,40}$/),
  recordedAt: Timestamp,
});
export type ReviewFinding = z.infer<typeof ReviewFinding>;

/**
 * Caps on stored verdicts (ADR-0028, ADR-0097 PR B): findings one verdict keeps, and verdicts
 * kept per project (the oldest go). 100 verdicts cover at least 50 PRs, over the 20 a sweep reads.
 */
export const REVIEW_VERDICT_LIMITS = { findings: 50, perProject: 100 } as const;

/**
 * One reviewer's latest verdict on one PR, as stored: a later verdict on the same PR by the same
 * reviewer replaces it. `findings` repeat the verdict's fields so `recent` reads them flat.
 */
export const ReviewVerdict = z.object({
  projectId: Id,
  repo: ReviewFinding.shape.repo,
  pullNumber: ReviewFinding.shape.pullNumber,
  reviewer: ReviewerRole,
  headSha: ReviewFinding.shape.headSha,
  recordedAt: Timestamp,
  findings: z.array(ReviewFinding).max(REVIEW_VERDICT_LIMITS.findings),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

/**
 * What the review workflow posts for one verdict (`POST /review/findings`). The repo, PR and
 * reviewer come from the caller's Actions OIDC token, never from this body.
 */
export const ReviewVerdictReport = z.strictObject({
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  findings: z
    .array(
      z.strictObject({
        severity: FindingSeverity,
        kind: FindingKind,
        title: z.string().max(REVIEW_FINDING_LIMITS.title),
        file: z.string().max(REVIEW_FINDING_LIMITS.file).nullable(),
      }),
    )
    .max(REVIEW_VERDICT_LIMITS.findings),
});
export type ReviewVerdictReport = z.infer<typeof ReviewVerdictReport>;

/** Caps on what a proposal carries (ADR-0028). */
export const CONFIG_PROPOSAL_TEXT_MAX = 4_000;
export const CONFIG_PROPOSAL_MAX_PRS = 20;
export const CONFIG_PROPOSAL_MAX_EXAMPLES = 3;

/** The `entity` of a ConfigChange that proposes text for an agent rules or procedure file. */
export const AGENT_CONFIG_ENTITY = "agent_config";

/**
 * `ConfigChange.diff` for a proposal from repeated review findings: the target file in the
 * project's repo, the text to add, and the evidence. `examples` are finding titles as the
 * reviewer wrote them (untrusted text, already stripped to one plain line each).
 */
export const FindingProposalDiff = z.object({
  file: z.string().min(1).max(200),
  kind: FindingKind,
  proposedText: z.string().min(1).max(CONFIG_PROPOSAL_TEXT_MAX),
  pulls: z
    .array(z.object({ repo: z.string().min(1).max(140), number: z.number().int().positive() }))
    .min(1)
    .max(CONFIG_PROPOSAL_MAX_PRS),
  examples: z.array(z.string().max(REVIEW_FINDING_LIMITS.title)).max(CONFIG_PROPOSAL_MAX_EXAMPLES),
});
export type FindingProposalDiff = z.infer<typeof FindingProposalDiff>;

/**
 * Additive ConfigChange fields (ADR-0097); every one defaults, so stored documents without them
 * still read. `dedupeKey`: at most one pending change per key. `decidedBy`/`decidedAt`: who
 * rejected (or, later, accepted) it, as an actor (`user:<uid>`), never an email.
 */
export const configChangeProposalFields = {
  projectId: Id.nullable().default(null),
  dedupeKey: z.string().min(1).max(300).nullable().default(null),
  decidedBy: z.string().min(1).max(200).nullable().default(null),
  decidedAt: Timestamp.nullable().default(null),
};

/**
 * What one sweep for proposals did (ADR-0097). `throttled`: the project was swept under a
 * minute ago, so nothing was read. `heldByCap`: proposals not written, the pending cap reached.
 */
export const ConfigProposalSweep = z.object({
  projectId: Id,
  throttled: z.boolean(),
  findingsRead: z.number().int().nonnegative(),
  created: z.array(z.string()),
  alreadyPending: z.array(z.string()),
  heldByCap: z.number().int().nonnegative(),
});
export type ConfigProposalSweep = z.infer<typeof ConfigProposalSweep>;
