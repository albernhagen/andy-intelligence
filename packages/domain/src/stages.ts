import type { Stage } from "@andy/contracts";

/**
 * Allowed stage moves (ARCHITECTURE §4.1): forward one step, plus the backward moves the
 * pipeline needs (re-refine, retry, rework). Andy can force any move; the reason is optional (ADR-0057).
 * Cancelled is reached only through `TicketService.cancel` (it stops runs first) and reopens
 * to Backlog. Verifying (AI-181, ADR-0114) is a side step after review for projects that deploy:
 * it exits only to Done (verified) or In progress (failed; flagged Needs-you).
 */
export const TRANSITIONS: Readonly<Record<Stage, readonly Stage[]>> = {
  backlog: ["ready"],
  ready: ["in_progress", "backlog"],
  in_progress: ["ready_for_review", "ready"],
  ready_for_review: ["done", "verifying", "in_progress"],
  verifying: ["done", "in_progress"],
  done: [],
  cancelled: ["backlog"],
};

export function canTransition(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * The forward pipeline, in order. Stages outside it are never a forward move. Verifying is not on
 * it: only projects that deploy pass through it, so review → Done stays one step for the rest.
 */
export const PIPELINE: readonly Stage[] = [
  "backlog",
  "ready",
  "in_progress",
  "ready_for_review",
  "done",
];

/** Forward one step off the pipeline: into Verifying after review, and out of it to Done. */
const VERIFYING_STEPS: readonly (readonly [Stage, Stage])[] = [
  ["ready_for_review", "verifying"],
  ["verifying", "done"],
];

/** An allowed move that goes forward one step (no re-refine, retry or rework). */
export function isForwardMove(from: Stage, to: Stage): boolean {
  if (VERIFYING_STEPS.some(([f, t]) => f === from && t === to)) return true;
  const at = PIPELINE.indexOf(from);
  return at >= 0 && canTransition(from, to) && PIPELINE.indexOf(to) === at + 1;
}

/**
 * A move back to an earlier pipeline stage, any number of steps (ADR-0163): what a session may do
 * over MCP `move_ticket`. Never out of Done or Cancelled (those stay Andy's), never into Verifying.
 * Out of Verifying (merged, deploying) only to In progress: the failed-verification move, which
 * flags Needs-you (ADR-0114).
 */
export function isBackwardMove(from: Stage, to: Stage): boolean {
  if (from === "verifying") return to === "in_progress";
  if (from === "done" || from === "cancelled") return false;
  const at = PIPELINE.indexOf(from);
  const target = PIPELINE.indexOf(to);
  return at >= 0 && target >= 0 && target < at;
}

/**
 * The one-step forward moves from `from` to `to` along the pipeline, e.g. ready →
 * [in_progress, ready_for_review]. Empty when `to` isn't ahead of `from` in the pipeline.
 */
export function forwardPath(from: Stage, to: Stage): Stage[] {
  const start = PIPELINE.indexOf(from);
  const end = PIPELINE.indexOf(to);
  if (start < 0 || end <= start) return [];
  return PIPELINE.slice(start + 1, end + 1);
}

/** Where a pull request event moves a ticket to (ADR-0067; Verifying: ADR-0114). */
export type PullRequestTarget = "ready_for_review" | "verifying" | "done";

/**
 * ADR-0067: the stages a PR event moves a ticket from. Opened: anything before review. Merged:
 * anything not yet Done (into Verifying: anything before it). Cancelled is never in any list.
 */
export const PULL_REQUEST_SOURCES: Readonly<Record<PullRequestTarget, readonly Stage[]>> = {
  ready_for_review: ["backlog", "ready", "in_progress"],
  verifying: ["backlog", "ready", "in_progress", "ready_for_review"],
  done: ["backlog", "ready", "in_progress", "ready_for_review", "verifying"],
};

/** The one-step moves a PR event makes, e.g. backlog → [ready, in_progress, ready_for_review]. */
export function pullRequestPath(from: Stage, to: PullRequestTarget): Stage[] {
  if (!PULL_REQUEST_SOURCES[to].includes(from)) return [];
  if (from === "verifying") return ["done"];
  if (to === "verifying") return [...forwardPath(from, "ready_for_review"), "verifying"];
  return forwardPath(from, to);
}
