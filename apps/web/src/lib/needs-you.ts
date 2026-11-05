import type { Question, Ticket } from "@andy/contracts";

/**
 * The viewer's inbox from `GET /api/needs-you`: open questions, then flagged tickets that have
 * no open question (a ticket with questions is already shown through them). The API decides which
 * tickets are flagged, so the flag's name stays out of the UI. One item = one thing to answer.
 */
export type NeedsYou = { questions: Question[]; tickets: Ticket[] };

export function inboxItems(data: NeedsYou, projectId?: string) {
  const inScope = <T extends { projectId: string }>(items: T[]) =>
    projectId ? items.filter((i) => i.projectId === projectId) : items;
  const withQuestions = new Set(data.questions.map((q) => q.ticketId));
  return {
    questions: inScope(data.questions),
    flagged: inScope(data.tickets.filter((t) => !withQuestions.has(t.id))),
  };
}

/** How many items wait on the viewer: in total (header) and per project (picker). */
export function waitingCounts(data: NeedsYou) {
  const { questions, flagged } = inboxItems(data);
  const byProject = new Map<string, number>();
  for (const { projectId } of [...questions, ...flagged])
    byProject.set(projectId, (byProject.get(projectId) ?? 0) + 1);
  return { total: questions.length + flagged.length, byProject };
}
