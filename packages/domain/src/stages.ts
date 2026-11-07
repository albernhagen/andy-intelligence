import type { Stage } from "@andy/contracts";

/**
 * Allowed stage moves (ARCHITECTURE §4.1): forward one step, plus the backward moves the
 * pipeline needs (re-refine, retry, rework). Andy can force any move; the reason is optional (ADR-0057).
 * Cancelled is reached only through `TicketService.cancel` (it stops runs first) and reopens
 * to Backlog.
 */
export const TRANSITIONS: Readonly<Record<Stage, readonly Stage[]>> = {
  backlog: ["ready"],
  ready: ["in_progress", "backlog"],
  in_progress: ["ready_for_review", "ready"],
  ready_for_review: ["done", "in_progress"],
  done: [],
  cancelled: ["backlog"],
};

export function canTransition(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The forward pipeline, in order. Stages outside it are never a forward move. */
export const PIPELINE: readonly Stage[] = [
  "backlog",
  "ready",
  "in_progress",
  "ready_for_review",
  "done",
];

/** An allowed move that goes forward one step (no re-refine, retry or rework). */
export function isForwardMove(from: Stage, to: Stage): boolean {
  const at = PIPELINE.indexOf(from);
  return at >= 0 && canTransition(from, to) && PIPELINE.indexOf(to) === at + 1;
}

/**
 * The one-step forward moves from `from` to `to`, e.g. ready → [in_progress, ready_for_review].
 * Empty when `to` isn't ahead of `from` in the pipeline.
 */
export function forwardPath(from: Stage, to: Stage): Stage[] {
  const start = PIPELINE.indexOf(from);
  const end = PIPELINE.indexOf(to);
  if (start < 0 || end <= start) return [];
  return PIPELINE.slice(start + 1, end + 1);
}

/** Where a pull request event moves a ticket to (ADR-0067). */
export type PullRequestTarget = "ready_for_review" | "done";

/**
 * ADR-0067: the stages a PR event moves a ticket from. Opened: anything before review. Merged:
 * anything not yet Done. Cancelled is never in either list.
 */
export const PULL_REQUEST_SOURCES: Readonly<Record<PullRequestTarget, readonly Stage[]>> = {
  ready_for_review: ["backlog", "ready", "in_progress"],
  done: ["backlog", "ready", "in_progress", "ready_for_review"],
};

/** The one-step moves a PR event makes, e.g. backlog → [ready, in_progress, ready_for_review]. */
export function pullRequestPath(from: Stage, to: PullRequestTarget): Stage[] {
  return PULL_REQUEST_SOURCES[to].includes(from) ? forwardPath(from, to) : [];
}
