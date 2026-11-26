import { z } from "zod";

/**
 * A verify verdict (AI-182, ADR-0114 "Verifying stage"): the verify procedure's result for one
 * deployment, per ticket pass or fail with evidence. `platform/procedures/verify.schema.json` is
 * the agent's copy; this schema is the check, including that each verdict follows from its parts
 * (procedure step 5). All text is untrusted agent output, so every field is capped (ADR-0028).
 * The verify run that produces and reads it is AI-188: M6.7.
 */

export const VERIFY_LIMITS = {
  summary: 4000,
  /** Tickets one release may verify in one run. */
  tickets: 50,
  criteria: 10,
  criterion: 500,
  reason: 1000,
  evidence: 10,
  detail: 2000,
  tests: 10,
  command: 500,
  output: 4000,
} as const;

/** The verify run's wall-clock cap, in minutes (ADR-0028); the procedure states it. */
export const VERIFY_CAP_MINUTES = 20;

const capped = (max: number) => z.string().trim().min(1).max(max);

// Local copy of TicketKey (./index imports this file).
const Key = z.string().regex(/^[A-Z][A-Z0-9]{0,9}-[0-9]+$/);

export const VerifyOutcome = z.enum(["pass", "fail"]);
export type VerifyOutcome = z.infer<typeof VerifyOutcome>;

export const CriterionResult = z.enum(["pass", "fail", "skipped"]);
export type CriterionResult = z.infer<typeof CriterionResult>;

export const EvidenceKind = z.enum(["request", "response", "screenshot", "test", "log", "note"]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const VerifyEvidence = z.strictObject({
  kind: EvidenceKind,
  detail: capped(VERIFY_LIMITS.detail),
});
export type VerifyEvidence = z.infer<typeof VerifyEvidence>;

/** One acceptance criterion's check: pass and fail need evidence, skipped needs a reason. */
export const CriterionCheck = z
  .strictObject({
    criterion: capped(VERIFY_LIMITS.criterion),
    result: CriterionResult,
    reason: z.string().trim().max(VERIFY_LIMITS.reason),
    evidence: z.array(VerifyEvidence).max(VERIFY_LIMITS.evidence),
  })
  .superRefine((c, ctx) => {
    if (c.result === "skipped" && c.reason === "") {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "a skipped check needs a reason" });
    }
    if (c.result !== "skipped" && c.evidence.length === 0) {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: "pass or fail needs evidence" });
    }
  });
export type CriterionCheck = z.infer<typeof CriterionCheck>;

/** A ticket fails if any criterion fails; skipped does not fail it. */
export const TicketVerdict = z
  .strictObject({
    key: Key,
    verdict: VerifyOutcome,
    criteria: z.array(CriterionCheck).min(1).max(VERIFY_LIMITS.criteria),
  })
  .superRefine((t, ctx) => {
    const expected = t.criteria.some((c) => c.result === "fail") ? "fail" : "pass";
    if (t.verdict !== expected) {
      ctx.addIssue({ code: "custom", path: ["verdict"], message: `verdict must be ${expected}` });
    }
  });
export type TicketVerdict = z.infer<typeof TicketVerdict>;

export const VerifyTestRun = z.strictObject({
  command: capped(VERIFY_LIMITS.command),
  passed: z.boolean(),
  output: z.string().max(VERIFY_LIMITS.output),
});
export type VerifyTestRun = z.infer<typeof VerifyTestRun>;

/** The release fails if any ticket fails or any test failed. Ticket keys are unique. */
export const VerifyVerdict = z
  .strictObject({
    summary: capped(VERIFY_LIMITS.summary),
    verdict: VerifyOutcome,
    tests: z.array(VerifyTestRun).max(VERIFY_LIMITS.tests),
    tickets: z.array(TicketVerdict).min(1).max(VERIFY_LIMITS.tickets),
  })
  .superRefine((v, ctx) => {
    const failed = v.tickets.some((t) => t.verdict === "fail") || v.tests.some((t) => !t.passed);
    const expected = failed ? "fail" : "pass";
    if (v.verdict !== expected) {
      ctx.addIssue({ code: "custom", path: ["verdict"], message: `verdict must be ${expected}` });
    }
    const keys = v.tickets.map((t) => t.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", path: ["tickets"], message: "ticket keys must be unique" });
    }
  });
export type VerifyVerdict = z.infer<typeof VerifyVerdict>;
