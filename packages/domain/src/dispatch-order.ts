import type { Project } from "@andy/contracts";
import { MAX_ACTIVE_RUNS_GLOBAL } from "./dispatch-caps";

/** Other projects one run's end may dispatch before its own (ADR-0028: every fan-out capped). */
export const MAX_PROJECTS_WOKEN_PER_RUN_END = 10;

/**
 * The order projects are woken in when a run ends and frees a global slot (ADR-0079, AI-91).
 * Pure: the API lists the projects and dispatches each in turn.
 *
 * 1. Projects idle on `global_cap`, longest wait first (`lastDispatch.at`, the decision's start).
 * 2. Every other project, least recent decision first (none yet counts as oldest). A sync or a
 *    refine waiting on the global cap is not recorded on `lastDispatch`, so it has no guaranteed
 *    place: a build waiter takes the slot before it, and it gets a turn only in this group.
 * 3. The project whose run ended, last, so it can't refill the slot before the others.
 *
 * A project that starts a run records a fresh `at` and so goes behind the others next time:
 * slots alternate between projects that all have work.
 */
export function dispatchOrder(
  projects: readonly Pick<Project, "id" | "lastDispatch">[],
  freedBy: string,
): string[] {
  const others = projects.filter((p) => p.id !== freedBy);
  const waiting = (p: Pick<Project, "lastDispatch">) =>
    p.lastDispatch?.decision === "global_cap" ? 0 : 1;
  const since = (p: Pick<Project, "lastDispatch">) => p.lastDispatch?.at ?? "";
  const ordered = [...others].sort(
    (a, b) => waiting(a) - waiting(b) || since(a).localeCompare(since(b)),
  );
  return [...ordered.map((p) => p.id), freedBy];
}

export interface RunEndWake {
  /** The project whose run just ended. */
  freedBy: string;
  listProjects: () => Promise<readonly Pick<Project, "id" | "lastDispatch">[]>;
  /** Runs in flight across all projects, now. */
  globalActive: () => Promise<number>;
  /** Dispatches one project; `wakeWaiters` asks it to wake build waiters itself. Never throws. */
  dispatch: (projectId: string, wakeWaiters: boolean) => Promise<void>;
}

/**
 * Hands the slot a run's end freed to the other projects in `dispatchOrder`, then dispatches the
 * freeing project (AI-91). Bounded: others are woken only when the global cap was full before
 * this end (otherwise none could be waiting on it), the walk stops once the cap is full again,
 * and at most `MAX_PROJECTS_WOKEN_PER_RUN_END` are tried. Returns the other projects woken.
 */
export async function wakeAfterRunEnd(wake: RunEndWake): Promise<string[]> {
  const woken: string[] = [];
  if ((await wake.globalActive()) < MAX_ACTIVE_RUNS_GLOBAL - 1) {
    await wake.dispatch(wake.freedBy, true);
    return woken;
  }
  const others = dispatchOrder(await wake.listProjects(), wake.freedBy).slice(0, -1);
  for (const id of others.slice(0, MAX_PROJECTS_WOKEN_PER_RUN_END)) {
    if ((await wake.globalActive()) >= MAX_ACTIVE_RUNS_GLOBAL) break;
    await wake.dispatch(id, false);
    woken.push(id);
  }
  await wake.dispatch(wake.freedBy, false);
  return woken;
}
