import type {
  ExecutorKind,
  ExecutorView,
  Project,
  ResolvedExecutor,
  Runner,
  Ticket,
} from "@andy/contracts";

/**
 * Where a ticket's runs execute (ADR-0089). Pure and resolved at read time, like the worker
 * (ADR-0082): never copied onto the ticket, so a project default change applies to every ticket
 * without its own pick.
 */

type ExecutorTicket = Pick<Ticket, "overrides">;
type ExecutorProject = Pick<Project, "executor">;

/** The ticket's pick if it has one, else the project's default; presence not considered. */
export function wantedExecutor(ticket: ExecutorTicket, project: ExecutorProject): ExecutorKind {
  return ticket.overrides.executor ?? project.executor;
}

/**
 * Where the next run goes. A project default of `local` falls back to `actions` while no runner
 * is present; a ticket override of `local` waits instead (Andy, 2026-11-11: an explicit override
 * means what it says).
 */
export function resolveExecutor(
  ticket: ExecutorTicket,
  project: ExecutorProject,
  runnerPresent: boolean,
): ResolvedExecutor {
  if (wantedExecutor(ticket, project) === "actions") return "actions";
  if (runnerPresent) return "local";
  return ticket.overrides.executor === "local" ? "wait" : "actions";
}

export function executorView(
  ticket: ExecutorTicket,
  project: ExecutorProject,
  runnerPresent: boolean,
): ExecutorView {
  return {
    executor: wantedExecutor(ticket, project),
    override: ticket.overrides.executor ?? null,
    projectDefault: project.executor,
    next: resolveExecutor(ticket, project, runnerPresent),
    runnerPresent,
  };
}

/** Which executor a dispatch call fills: the cloud executor, or the runner that claims. */
export type DispatchRoute = { kind: "actions" } | { kind: "local"; runner: Runner };

export const ACTIONS_ROUTE: DispatchRoute = { kind: "actions" };

/**
 * Whether a dispatch for `route` may take the ticket (ADR-0089): the cloud dispatchers take
 * only tickets that resolve to `actions` (so they skip `local` ones while a runner is present,
 * and ones waiting for an away runner); a runner's claim only `local` ones in its projects.
 */
export function routeTakes(
  route: DispatchRoute,
  ticket: ExecutorTicket,
  project: ExecutorProject & Pick<Project, "id">,
  runnerPresent: boolean,
): boolean {
  if (route.kind === "actions")
    return resolveExecutor(ticket, project, runnerPresent) === "actions";
  return (
    route.runner.projectIds.includes(project.id) && wantedExecutor(ticket, project) === "local"
  );
}
