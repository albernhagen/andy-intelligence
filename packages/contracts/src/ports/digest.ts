import { z } from "zod";
import {
  GateReason,
  QuotaDelta,
  RunOutcome,
  RunStatus,
  RunStep,
  Timestamp,
  TicketKey,
} from "../entities";
import { DigestSummaryDate, DigestSummaryOutput } from "../entities/digest-summary";

/**
 * The daily digest (AI-70, ADR-0081): a read model computed on read for a project and a window,
 * never stored. Sections in order: exceptions, merged, in progress, totals.
 */

/** Longest window a digest covers (ADR-0028: bounds the reads per request). */
export const DIGEST_MAX_HOURS = 168;
export const DIGEST_DEFAULT_HOURS = 24;

export const DigestExceptionKind = z.enum([
  "run_failed",
  "pr_closed",
  "reworked",
  "reverted",
  "review_blocker",
  "waiting_on_andy",
  "blocked",
  "dispatch_idle",
  "quota_reserve",
  // A sync run stopped on a conflict or failing checks (AI-72, ADR-0083).
  "sync_stopped",
  // An open agent PR's sync waits on a cap (AI-72, ADR-0083).
  "sync_waiting",
  // Andy cleared a quota reading that held dispatch at the reserve (AI-74).
  "quota_cleared",
]);
export type DigestExceptionKind = z.infer<typeof DigestExceptionKind>;

export const DigestException = z.object({
  kind: DigestExceptionKind,
  ticketKey: TicketKey.nullable(),
  title: z.string().nullable(),
  prNumber: z.number().int().positive().nullable(),
  /** Plain words for Andy: why it is here. */
  reason: z.string(),
  at: Timestamp.nullable(),
});
export type DigestException = z.infer<typeof DigestException>;

export const DigestMerged = z.object({
  ticketKey: TicketKey,
  title: z.string(),
  prNumber: z.number().int().positive(),
  prUrl: z.url(),
  mergedAt: Timestamp,
  /**
   * `gate`: the control plane merged it (auto-merge); `andy`: merged by hand; `unknown`: no run
   * links to this PR, so nothing says who merged it.
   */
  mergedBy: z.enum(["gate", "andy", "unknown"]),
  /** The gate's record on the run that opened the PR; null when no run links to it. */
  gate: z
    .object({
      wouldAutoMerge: z.boolean().nullable(),
      reasons: z.array(GateReason),
      outcome: RunOutcome.nullable(),
    })
    .nullable(),
  /** The ticket's estimated cost over all its finished runs (AI-67). */
  costUsd: z.number().nonnegative(),
  unknownCostRuns: z.number().int().nonnegative(),
});
export type DigestMerged = z.infer<typeof DigestMerged>;

export const DigestInFlight = z.object({
  ticketKey: TicketKey.nullable(),
  title: z.string().nullable(),
  step: RunStep,
  status: RunStatus,
  /** The board card's words, e.g. "Building · 12 min". */
  label: z.string(),
});
export type DigestInFlight = z.infer<typeof DigestInFlight>;

export const DigestReview = z.object({
  ticketKey: TicketKey,
  title: z.string(),
  prNumber: z.number().int().positive().nullable(),
});
export type DigestReview = z.infer<typeof DigestReview>;

export const DigestTotals = z.object({
  /** Runs that ended in the window. */
  runs: z.number().int().nonnegative(),
  failedRuns: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  unknownCostRuns: z.number().int().nonnegative(),
  quotaDelta: QuotaDelta,
  merged: z.number().int().nonnegative(),
});
export type DigestTotals = z.infer<typeof DigestTotals>;

/**
 * The latest finished day's model-written summary as the digest shows it (AI-323, ADR-0137).
 * `ready`: `output` is set. `writing`: its agent task runs. `waiting`: claimed, but the task
 * couldn't start yet (pause, quota reserve, run caps); Andy's next read tries again.
 * `failed`: `reason` says why. `not_started`: nobody who can start it has read the digest since
 * the day ended, or the day's cap across projects is used.
 */
export const DigestSummaryState = z.enum(["ready", "writing", "waiting", "failed", "not_started"]);
export type DigestSummaryState = z.infer<typeof DigestSummaryState>;

export const DigestSummaryView = z.object({
  day: DigestSummaryDate,
  timeZone: z.string(),
  state: DigestSummaryState,
  output: DigestSummaryOutput.nullable(),
  /** Plain words for Andy when there is no summary; null when ready or writing. */
  reason: z.string().nullable(),
  /** The model that wrote it, e.g. "sonnet"; null until it is dispatched. */
  model: z.string().nullable(),
  /** When it was stored; null unless ready. */
  writtenAt: Timestamp.nullable(),
  /** True when a retry by hand would start (failed, attempts left, not a quiet day). */
  canRetry: z.boolean(),
});
export type DigestSummaryView = z.infer<typeof DigestSummaryView>;

export const Digest = z.object({
  projectKey: z.string(),
  window: z.object({ from: Timestamp, to: Timestamp }),
  /** True when nothing happened and every read was complete: `text` is one line. */
  quiet: z.boolean(),
  exceptions: z.array(DigestException),
  merged: z.array(DigestMerged),
  inProgress: z.object({
    inFlight: z.array(DigestInFlight),
    readyForReview: z.array(DigestReview),
  }),
  totals: DigestTotals,
  /** True when a read cap was reached (ADR-0028): tickets or runs may be missing. */
  truncated: z.boolean(),
  /** The same digest as plain text, for Claude desktop and chat. */
  text: z.string(),
  /** AI-323: the latest finished day's summary; null where it isn't wired. */
  summary: DigestSummaryView.nullable().default(null),
});
export type Digest = z.infer<typeof Digest>;
