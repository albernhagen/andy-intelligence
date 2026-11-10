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
});
export type Digest = z.infer<typeof Digest>;
