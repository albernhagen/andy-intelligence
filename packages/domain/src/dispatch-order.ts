import type { Project } from "@andy/contracts";

/**
 * The order projects are woken in when a run ends and frees a global slot (ADR-0079, AI-91).
 * Pure: the API lists the projects and dispatches each in turn.
 *
 * 1. Projects idle on `global_cap`, longest wait first (`lastDispatch.at`, the decision's start).
 * 2. Every other project, least recent decision first (none yet counts as oldest): a sync or a
 *    refine waiting on the global cap is not recorded on `lastDispatch`, so these get a turn too.
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
