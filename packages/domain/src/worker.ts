import type { Project, Ticket, Worker, WorkerChoice, WorkerView } from "@andy/contracts";

/**
 * Who does a ticket's work (ADR-0082). Pure and resolved at read time: never copied onto the
 * ticket, so changing a project's default applies to every ticket without its own pick.
 */

type WorkerTicket = Pick<Ticket, "overrides">;
type WorkerProject = Pick<Project, "defaultWorker">;

/** The ticket's own pick, if any. A harness key (e.g. `claude-code`) is an agent. */
function override(ticket: WorkerTicket): WorkerChoice | null {
  const assignee = ticket.overrides.assignee;
  if (!assignee) return null;
  return assignee === "me" ? "me" : "agent";
}

/** The ticket's pick if it has one, else the project's default. */
export function resolveWorker(ticket: WorkerTicket, project: WorkerProject): Worker {
  return override(ticket) ?? project.defaultWorker;
}

/** An agent may build it. Andy's own tickets and unpicked `ask` tickets never build; refine isn't gated. */
export function isDispatchable(ticket: WorkerTicket, project: WorkerProject): boolean {
  return resolveWorker(ticket, project) === "agent";
}

export function workerView(ticket: WorkerTicket, project: WorkerProject): WorkerView {
  return {
    worker: resolveWorker(ticket, project),
    override: override(ticket),
    projectDefault: project.defaultWorker,
  };
}
