import type { Stage } from "@andy/contracts";

/**
 * Allowed stage moves (ARCHITECTURE §4.1): forward one step, plus the backward moves the
 * pipeline needs (re-refine, retry, rework). Andy can force any move; the reason is optional (ADR-0057).
 */
export const TRANSITIONS: Readonly<Record<Stage, readonly Stage[]>> = {
  backlog: ["ready"],
  ready: ["in_progress", "backlog"],
  in_progress: ["ready_for_review", "ready"],
  ready_for_review: ["monitoring", "in_progress"],
  monitoring: ["done", "in_progress"],
  done: [],
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
  "monitoring",
  "done",
];

/** An allowed move that goes forward one step (no re-refine, retry or rework). */
export function isForwardMove(from: Stage, to: Stage): boolean {
  return canTransition(from, to) && PIPELINE.indexOf(to) === PIPELINE.indexOf(from) + 1;
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
