import type { Stage } from "@andy/contracts";

/**
 * Allowed stage moves (ARCHITECTURE §4.1): forward one step, plus the backward moves the
 * pipeline needs (re-refine, retry, rework). Andy can force any move with a reason. Cancelled is
 * reached only through `TicketService.cancel` (it stops runs first) and reopens to Backlog.
 */
export const TRANSITIONS: Readonly<Record<Stage, readonly Stage[]>> = {
  backlog: ["ready"],
  ready: ["in_progress", "backlog"],
  in_progress: ["ready_for_review", "ready"],
  ready_for_review: ["monitoring", "in_progress"],
  monitoring: ["done", "in_progress"],
  done: [],
  cancelled: ["backlog"],
};

export function canTransition(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}
