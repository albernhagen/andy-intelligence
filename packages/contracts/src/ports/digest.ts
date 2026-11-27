import { z } from "zod";
import {
  GateReason,
  MergeWaitReason,
  QuotaDelta,
  RunOutcome,
  RunStatus,
  RunStep,
  Timestamp,
  TicketKey,
} from "../entities";
import { DigestSummaryDate, DigestSummaryOutput } from "../entities/digest-summary";
import { MergeMode } from "../entities/merge-mode";

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
  // Merges into a repo's default branch are held while it is red (AI-382, ADR-0154).
  "merge_held",
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

// ── Handover (AI-385) ────────────────────────────────────────────────────────
// What a coordinator session used to write by hand: each open PR with why it waits, and the
// Ready tickets the dispatcher would take next. Computed on read from what the gate and the
// dispatcher already decide; only for a window that reaches now (current state).

/** Open PRs one digest lists (ADR-0028); `openPrsTruncated` says when more exist. */
export const DIGEST_OPEN_PRS_MAX = 20;
/** Ready tickets one digest lists as next up (ADR-0028); `nextUpTruncated` says when more exist. */
export const DIGEST_NEXT_UP_MAX = 10;

export const DigestOpenPr = z.object({
  ticketKey: TicketKey,
  title: z.string(),
  prNumber: z.number().int().positive(),
  prUrl: z.url(),
  /**
   * `waiting`: the merge gate's last verdict on it was wait; `merging`: its verdict was merge (it
   * merges through the queue); `not_judged`: no verdict recorded (not an agent PR, or the gate
   * hasn't judged its head yet).
   */
  state: z.enum(["waiting", "merging", "not_judged"]),
  /** The mode the gate applied; null when not judged or no mode is saved. */
  mergeMode: MergeMode.nullable(),
  /** `mergeVerdict`'s reasons as the gate recorded them; empty unless `waiting`. */
  reasons: z.array(MergeWaitReason),
  /** One plain sentence per reason (or why it has none), for a reader with no context. */
  lines: z.array(z.string()),
});
export type DigestOpenPr = z.infer<typeof DigestOpenPr>;

export const DigestNextUpItem = z.object({
  ticketKey: TicketKey,
  title: z.string(),
  /**
   * `starts_now`: the dispatcher would start it on its next pass; `next`: in line, waiting for
   * what `idle` names; `skipped`: passed over, `reason` says why.
   */
  status: z.enum(["starts_now", "next", "skipped"]),
  /** Why it is skipped, or a note on how it starts (a plan run first); null otherwise. */
  reason: z.string().nullable(),
});
export type DigestNextUpItem = z.infer<typeof DigestNextUpItem>;

export const DigestHandover = z.object({
  openPrs: z.array(DigestOpenPr),
  /** More open PRs than `DIGEST_OPEN_PRS_MAX`, or tickets in review the read cap left out. */
  openPrsTruncated: z.boolean(),
  /** Ready tickets in the order the dispatcher takes them (rank), epics left out. */
  nextUp: z.array(DigestNextUpItem),
  /** More Ready tickets than `DIGEST_NEXT_UP_MAX`. */
  nextUpTruncated: z.boolean(),
  /** One line: why nothing (more) starts now. */
  idle: z.string(),
});
export type DigestHandover = z.infer<typeof DigestHandover>;

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
  /** AI-385: open PRs and next up; null for a window that doesn't reach now. */
  handover: DigestHandover.nullable().default(null),
});
export type Digest = z.infer<typeof Digest>;
