import type { Project, Ticket, Worker, WorkerChoice, WorkerView } from "@andy/contracts";
import { effectiveOverrides } from "./overrides";

/**
 * Who does a ticket's work (ADR-0082). Pure and resolved at read time: never copied onto the
 * ticket, so changing a project's default applies to every ticket without its own pick. A
 * ticket without its own pick takes its epic's (AI-116), then the project's default.
 */

type WorkerTicket = Pick<Ticket, "overrides">;
type WorkerProject = Pick<Project, "defaultWorker">;
type WorkerEpic = Pick<Ticket, "overrides"> | null | undefined;

/** The ticket's pick (or its epic's), if any. A harness key (e.g. `claude-code`) is an agent. */
function override(ticket: WorkerTicket, epic?: WorkerEpic): WorkerChoice | null {
  const assignee = effectiveOverrides(ticket, epic).assignee;
  if (!assignee) return null;
  return assignee === "me" ? "me" : "agent";
}

/** The ticket's pick if it has one, else its epic's, else the project's default. */
export function resolveWorker(
  ticket: WorkerTicket,
  project: WorkerProject,
  epic?: WorkerEpic,
): Worker {
  return override(ticket, epic) ?? project.defaultWorker;
}

/** An agent may build it. Andy's own tickets and unpicked `ask` tickets never build; refine isn't gated. */
export function isDispatchable(
  ticket: WorkerTicket,
  project: WorkerProject,
  epic?: WorkerEpic,
): boolean {
  return resolveWorker(ticket, project, epic) === "agent";
}

export function workerView(ticket: WorkerTicket, project: WorkerProject): WorkerView {
  return {
    worker: resolveWorker(ticket, project),
    override: override(ticket),
    projectDefault: project.defaultWorker,
  };
}
