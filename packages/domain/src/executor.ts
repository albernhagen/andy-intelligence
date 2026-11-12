import type {
  ExecutorKind,
  ExecutorView,
  Project,
  ResolvedExecutor,
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

export function executorView(ticket: ExecutorTicket, project: ExecutorProject): ExecutorView {
  return {
    executor: wantedExecutor(ticket, project),
    override: ticket.overrides.executor ?? null,
    projectDefault: project.executor,
  };
}
