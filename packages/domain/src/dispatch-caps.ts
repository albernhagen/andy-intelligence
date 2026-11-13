import type {
  DispatchDecision,
  DispatchIdleReason,
  Project,
  QuotaLevel,
  Run,
} from "@andy/contracts";

/** Dispatch caps (ADR-0079, ADR-0028). Pure: `BuildDispatcher` gathers the counts. */

/** Runs in flight across all projects (ADR-0079). */
export const MAX_ACTIVE_RUNS_GLOBAL = 4;

/**
 * Runs in flight across all projects while quota is at `warn` (AI-92): one, so parallel runs
 * started just under `pause` can't overshoot the subscription reserve (ARCHITECTURE §5).
 */
export const MAX_ACTIVE_RUNS_AT_WARN = 1;

/** Agent PRs a project may have waiting for Andy, counting the runs that may open one (ADR-0079). */
export const MAX_PRS_WAITING_PER_PROJECT = 5;

export interface DispatchCounts {
  /** Runs in flight in this project, of any step. */
  projectActive: number;
  /** Runs in flight across all projects, of any step. */
  globalActive: number;
  /** Open, unmerged PRs the system opened in this project. */
  prsWaiting: number;
  /**
   * The subscription's worst quota level: `pause` stops dispatch, `warn` allows one run in flight
   * across all projects, `ok` and `unknown` don't limit it.
   */
  quotaLevel: QuotaLevel;
}

/** Whether the dispatcher may start one more run in the project, or why not. */
export function mayDispatch(
  project: Pick<Project, "paused" | "runsAtOnce">,
  counts: DispatchCounts,
): "start" | DispatchIdleReason {
  if (project.paused) return "paused";
  if (counts.projectActive >= project.runsAtOnce) return "project_cap";
  if (counts.globalActive >= MAX_ACTIVE_RUNS_GLOBAL) return "global_cap";
  // Each run in flight may open a PR, so counting them keeps the cap from being overshot.
  if (counts.prsWaiting + counts.projectActive >= MAX_PRS_WAITING_PER_PROJECT) {
    return "prs_waiting_cap";
  }
  if (counts.quotaLevel === "pause") return "quota_reserve";
  if (atWarnCap(counts)) return "quota_warn";
  return "start";
}

/**
 * A project held only by a cap across all projects: the global cap, or the warn cap (AI-92). A
 * run's end wakes these first, longest wait first (ADR-0079, AI-91).
 */
export function waitsForSlot(decision: DispatchDecision | undefined): boolean {
  return decision === "global_cap" || decision === "quota_warn";
}

/** Quota at `warn` and the warn cap reached (AI-92); builds and syncs both ask this. */
export function atWarnCap(counts: Pick<DispatchCounts, "quotaLevel" | "globalActive">): boolean {
  return counts.quotaLevel === "warn" && counts.globalActive >= MAX_ACTIVE_RUNS_AT_WARN;
}

/**
 * The one definition of a run in flight (ADR-0079, ADR-0080): queued or running and not past its
 * deadline, so a lost report can't hold a slot or block a ticket until the watchdog settles it.
 * The caps, the overlap check, the in-flight view and the status line all use it.
 */
export function isInFlight(run: Pick<Run, "status" | "deadline">, now: Date): boolean {
  return (
    (run.status === "queued" || run.status === "running") &&
    (!run.deadline || Date.parse(run.deadline) > now.getTime())
  );
}

/**
 * A run that reached an executor: dispatched to the cloud executor or claimed by a local runner
 * (ADR-0089). Per-ticket run caps count these: each one may have spent quota.
 */
export function wasDispatched(run: Pick<Run, "executor" | "localRun">): boolean {
  return run.executor !== null || run.localRun != null;
}
