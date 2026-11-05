import type { Run, RunStatus } from "@andy/contracts";

/**
 * Run watchdog rules (M1.6b: Claude Code executor: watchdog + retry, ARCHITECTURE §7.1). Pure
 * decisions; `RunService` applies them. The watchdog looks at a run once, at its deadline.
 */

/** A first attempt plus at most one automatic retry (ADR-0028 cap). */
export const MAX_RUN_ATTEMPTS = 2;

/** What the watchdog does with a run still in flight at its deadline. */
export type DeadlineAction =
  /** The executor finished fine but the report never arrived: record the success. */
  | { kind: "heal" }
  /** The run is over or must be stopped: end it, then retry or flag Needs-you. */
  | { kind: "end"; status: "failed" | "cancelled"; cancel: boolean; error: string };

/**
 * The action for an active run at its deadline, given what the executor says about it
 * (`null` when it can't be asked: the run has no executor record, or none is connected).
 */
export function deadlineAction(executorStatus: RunStatus | null): DeadlineAction {
  switch (executorStatus) {
    case null:
      return {
        kind: "end",
        status: "failed",
        cancel: false,
        error: "couldn't be checked: no executor",
      };
    case "succeeded":
      return { kind: "heal" };
    case "failed":
      return { kind: "end", status: "failed", cancel: false, error: "failed without reporting" };
    case "cancelled":
      return { kind: "end", status: "cancelled", cancel: false, error: "was cancelled" };
    case "queued":
    case "running":
      return { kind: "end", status: "cancelled", cancel: true, error: "passed its deadline" };
  }
}

/** After a run fails or is killed: retry once, else flag the ticket Needs-you. */
export function afterFailure(run: Pick<Run, "attempt">): "retry" | "flag" {
  return run.attempt < MAX_RUN_ATTEMPTS ? "retry" : "flag";
}
