import { z } from "zod";
import { Id, Route, Timestamp } from "./common";

/**
 * Digest summary (AI-323, ADR-0137): a short model-written account of what was done in one
 * project on one day, written once by the `summarize` agent task and stored, so a digest read
 * costs one more document read, never a model call. Its input (release notes, ticket titles) is
 * untrusted data, never instructions.
 */

/**
 * Days end at midnight in this time zone (Andy's choice, 2026-11-21). A named zone, not an
 * offset, so daylight saving moves the boundary with the clocks.
 */
export const DIGEST_SUMMARY_TIME_ZONE = "America/Denver";

/** Caps (ADR-0028). */
export const DIGEST_SUMMARY_LIMITS = {
  /** Words in the summary paragraph. */
  summaryWords: 120,
  /** Characters in the summary paragraph (a backstop on the word cap). */
  summaryChars: 900,
  /** Lines, one per milestone or epic. */
  lines: 12,
  lineChars: 300,
  headingChars: 120,
  /** Ticket keys or PR numbers cited by one line or by the summary. */
  refs: 10,
  /** Merged PRs given to the agent; more are cut and the summary says so. */
  inputPrs: 50,
  /** Characters of input data given to the agent. */
  inputChars: 24_000,
  /** Writes per project per day: the first, and one retry by hand after a failure. */
  attempts: 2,
  /** Writes started per day across all projects, retries included. */
  perDay: 10,
  failureDetailChars: 300,
} as const;

const L = DIGEST_SUMMARY_LIMITS;

/** `YYYY-MM-DD`: a day in DIGEST_SUMMARY_TIME_ZONE, and the stored summary's id. */
export const DigestSummaryDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type DigestSummaryDate = z.infer<typeof DigestSummaryDate>;

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** What a line or the summary rests on: at least one ticket key or PR number from the input. */
export const DigestSummaryRefs = z
  .object({
    tickets: z
      .array(z.string().regex(/^[A-Z][A-Z0-9]{0,9}-\d+$/))
      .max(L.refs)
      .default([]),
    prs: z.array(z.number().int().positive()).max(L.refs).default([]),
  })
  .refine((r) => r.tickets.length + r.prs.length > 0, { message: "cite a ticket or a PR" })
  .refine((r) => r.tickets.length + r.prs.length <= L.refs, {
    message: `at most ${L.refs} refs`,
  });
export type DigestSummaryRefs = z.infer<typeof DigestSummaryRefs>;

export const DigestSummaryLine = z.object({
  /** The milestone or epic the line is about, as titled in the input. */
  heading: z.string().min(1).max(L.headingChars),
  /** The epic's key when the line is about one; AI-208 shows it on that epic's roadmap row. */
  epicKey: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{0,9}-\d+$/)
    .nullable(),
  text: z.string().min(1).max(L.lineChars),
  refs: DigestSummaryRefs,
});
export type DigestSummaryLine = z.infer<typeof DigestSummaryLine>;

/** The `summarize` task's output, checked by the executor's JSON schema and again here. */
export const DigestSummaryOutput = z.object({
  summary: z
    .string()
    .min(1)
    .max(L.summaryChars)
    .refine((s) => wordCount(s) <= L.summaryWords, {
      message: `at most ${L.summaryWords} words`,
    }),
  summaryRefs: DigestSummaryRefs,
  lines: z.array(DigestSummaryLine).max(L.lines),
});
export type DigestSummaryOutput = z.infer<typeof DigestSummaryOutput>;

/** `writing`: claimed, the task is running or about to. `ready`: stored. `failed`: see `failure`. */
export const DigestSummaryStatus = z.enum(["writing", "ready", "failed"]);
export type DigestSummaryStatus = z.infer<typeof DigestSummaryStatus>;

/**
 * Why no summary: the digest shows its plain list and says this. Nothing retries on its own.
 * `paused`, `quota_reserve`, `no_route`: dispatch refused. `run_failed`: the task failed or
 * timed out. `invalid_output`: the output failed the schema. `unknown_ref`: it cited a ticket
 * or PR that wasn't in its input. `dispatch_failed`: the executor couldn't be started.
 * `nothing_happened`: nothing merged or changed that day, so no task ran; not retryable.
 */
export const DigestSummaryFailureReason = z.enum([
  "paused",
  "quota_reserve",
  "no_route",
  "dispatch_failed",
  "run_failed",
  "invalid_output",
  "unknown_ref",
  "nothing_happened",
]);
export type DigestSummaryFailureReason = z.infer<typeof DigestSummaryFailureReason>;

export const DigestSummaryFailure = z.object({
  reason: DigestSummaryFailureReason,
  detail: z.string().max(L.failureDetailChars).nullable(),
});
export type DigestSummaryFailure = z.infer<typeof DigestSummaryFailure>;

export const DigestSummary = z
  .object({
    /** The day, `YYYY-MM-DD`: one summary per project per day. */
    id: DigestSummaryDate,
    projectId: Id,
    timeZone: z.string().min(1).max(64),
    /** The day's bounds as instants: `from` inclusive, `to` exclusive. */
    from: Timestamp,
    to: Timestamp,
    status: DigestSummaryStatus,
    /** Writes started for this day, at most DIGEST_SUMMARY_LIMITS.attempts. */
    attempts: z.number().int().min(1).max(L.attempts),
    /** The agent task writing it; null until dispatched. */
    runId: Id.nullable(),
    route: Route.nullable(),
    /** sha256 of the input given to the task, hex. */
    inputHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    /** The input was cut at its caps. */
    truncated: z.boolean(),
    output: DigestSummaryOutput.nullable(),
    failure: DigestSummaryFailure.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .refine((s) => (s.status === "ready") === (s.output !== null), {
    message: "output is set exactly when ready",
  })
  .refine((s) => (s.status === "failed") === (s.failure !== null), {
    message: "failure is set exactly when failed",
  });
export type DigestSummary = z.infer<typeof DigestSummary>;

/** A day to claim: its id and bounds. */
export const DigestSummaryPeriod = z.object({
  id: DigestSummaryDate,
  timeZone: z.string().min(1).max(64),
  from: Timestamp,
  to: Timestamp,
});
export type DigestSummaryPeriod = z.infer<typeof DigestSummaryPeriod>;

/** What the task's dispatch records on a summary still `writing`. */
export const DigestSummaryDispatch = z.object({
  runId: Id,
  route: Route,
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  truncated: z.boolean(),
});
export type DigestSummaryDispatch = z.infer<typeof DigestSummaryDispatch>;

// ── State changes ────────────────────────────────────────────────────────────
// Pure, so the in-memory fake and every adapter apply the same rules inside their own atomic
// update. Each returns the next summary, or null when the change doesn't apply.

/** A new day's summary: `writing`, attempt 1, no task yet. */
export function claimedDigestSummary(
  projectId: string,
  period: DigestSummaryPeriod,
  now: string,
): DigestSummary {
  return DigestSummary.parse({
    ...DigestSummaryPeriod.parse(period),
    projectId,
    status: "writing",
    attempts: 1,
    runId: null,
    route: null,
    inputHash: null,
    truncated: false,
    output: null,
    failure: null,
    createdAt: now,
    updatedAt: now,
  });
}

/** Why a retry can't start, or null when it can. */
export function digestSummaryRetryRefusal(s: DigestSummary): "not_failed" | "attempts_used" | null {
  if (s.status !== "failed" || s.failure?.reason === "nothing_happened") return "not_failed";
  if (s.attempts >= L.attempts) return "attempts_used";
  return null;
}

export function retriedDigestSummary(s: DigestSummary, now: string): DigestSummary {
  return DigestSummary.parse({
    ...s,
    status: "writing",
    attempts: s.attempts + 1,
    runId: null,
    route: null,
    inputHash: null,
    truncated: false,
    failure: null,
    updatedAt: now,
  });
}

export function dispatchedDigestSummary(
  s: DigestSummary,
  dispatch: DigestSummaryDispatch,
  now: string,
): DigestSummary | null {
  if (s.status !== "writing" || s.runId !== null) return null;
  return DigestSummary.parse({ ...s, ...DigestSummaryDispatch.parse(dispatch), updatedAt: now });
}

export function completedDigestSummary(
  s: DigestSummary,
  runId: string,
  output: DigestSummaryOutput,
  now: string,
): DigestSummary | null {
  if (s.status !== "writing" || s.runId === null || s.runId !== runId) return null;
  return DigestSummary.parse({
    ...s,
    status: "ready",
    output: DigestSummaryOutput.parse(output),
    updatedAt: now,
  });
}

export function failedDigestSummary(
  s: DigestSummary,
  runId: string | null,
  failure: DigestSummaryFailure,
  now: string,
): DigestSummary | null {
  if (s.status !== "writing" || s.runId !== runId) return null;
  return DigestSummary.parse({
    ...s,
    status: "failed",
    failure: DigestSummaryFailure.parse(failure),
    updatedAt: now,
  });
}

// ── Task input ───────────────────────────────────────────────────────────────

/**
 * What the `summarize` task reads (AI-323): built from stored facts by the domain, embedded in
 * the run's prompt as untrusted JSON, and parsed back at report to check its citations.
 */
const InputKey = z.string().regex(/^[A-Z][A-Z0-9]{0,9}-\d+$/);

/** What the task reads: built from stored facts, embedded in its prompt, parsed back at report. */
export const DigestSummaryInput = z.object({
  project: z.string(),
  day: z.string(),
  timeZone: z.string(),
  merged: z.array(
    z.object({
      pr: z.number().int().positive(),
      title: z.string(),
      ticketKey: InputKey.nullable(),
      ticketTitle: z.string().nullable(),
      epicKey: InputKey.nullable(),
      epicTitle: z.string().nullable(),
      milestone: z.string().nullable(),
      whatChanged: z.string().nullable(),
      howItWorks: z.string().nullable(),
      needsYou: z.string().nullable(),
    }),
  ),
  ticketChanges: z.array(
    z.object({
      key: InputKey,
      title: z.string(),
      stage: z.string(),
      epicKey: InputKey.nullable(),
      epicTitle: z.string().nullable(),
    }),
  ),
  counts: z.object({
    merged: z.number().int(),
    inProgress: z.number().int(),
    needsAndy: z.number().int(),
    costUsd: z.number(),
  }),
  truncated: z.boolean(),
});
export type DigestSummaryInput = z.infer<typeof DigestSummaryInput>;
