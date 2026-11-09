import { Stage, type Question, type Ticket } from "@andy/contracts";
import { checkDor } from "./dor";

const STAGES: readonly Stage[] = Stage.options;

/** Inbox order within a ticket: high urgency first, then oldest first. */
export function sortQuestions(questions: readonly Question[]): Question[] {
  const weight = { high: 0, normal: 1, low: 2 } as const;
  return [...questions].sort(
    (a, b) => weight[a.urgency] - weight[b.urgency] || a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * The viewer's inbox from `GET /api/needs-you` (or MCP `list_needs_me`; one order everywhere, AI-40): open questions, then flagged tickets that have
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

/**
 * One inbox card: a ticket with its open questions (most urgent first), or a flagged ticket with
 * none. `ticket` is missing only if the API listed a question without its ticket.
 */
export type InboxCard = {
  ticketId: string;
  projectId: string;
  ticket: Ticket | undefined;
  questions: Question[];
};

/** Items a card holds, as the header counts them: its questions, or 1 for a flagged ticket. */
export const cardCount = (card: InboxCard) => card.questions.length || 1;

/** Done, Cancelled or archived: nothing will build it, so its questions are listed last. */
export const isStale = (t: Ticket | undefined) =>
  !!t && (t.archived || t.stage === "done" || t.stage === "cancelled");

const URGENCY = { high: 0, normal: 1, low: 2 } as const;

/**
 * Which cards come first: answers that unblock work soonest (AI-30).
 * 0. Backlog tickets whose only Definition of Ready gap is their questions: answering moves
 *    them to Ready.
 * 1. Tickets already past Backlog (a question there holds up work in flight).
 * 2. Other Backlog tickets (they need more refinement after the answers).
 * 3. Questions whose ticket the API didn't return.
 */
function tier(t: Ticket | undefined): number {
  if (!t) return 3;
  if (t.stage !== "backlog") return 1;
  return checkDor(t, 0).met ? 0 : 2;
}

/** Questions are sorted most urgent first, so the first one sets the card's urgency. */
const topUrgency = (card: InboxCard) => URGENCY[card.questions[0]?.urgency ?? "low"];

function compareCards(a: InboxCard, b: InboxCard): number {
  const stageIndex = (c: InboxCard) => (c.ticket ? STAGES.indexOf(c.ticket.stage) : STAGES.length);
  const rank = (c: InboxCard) => c.ticket?.rank ?? "";
  return (
    tier(a.ticket) - tier(b.ticket) ||
    stageIndex(a) - stageIndex(b) ||
    rank(a).localeCompare(rank(b)) ||
    topUrgency(a) - topUrgency(b)
  );
}

/** The inbox as ticket cards in priority order, split into active and stale (listed last). */
export function inboxCards(data: NeedsYou, projectId?: string) {
  const { questions, flagged } = inboxItems(data, projectId);
  const tickets = new Map(data.tickets.map((t) => [t.id, t]));
  const cards = new Map<string, InboxCard>();
  for (const q of questions) {
    const card = cards.get(q.ticketId) ?? {
      ticketId: q.ticketId,
      projectId: q.projectId,
      ticket: tickets.get(q.ticketId),
      questions: [],
    };
    card.questions.push(q);
    cards.set(q.ticketId, card);
  }
  for (const t of flagged)
    cards.set(t.id, { ticketId: t.id, projectId: t.projectId, ticket: t, questions: [] });

  for (const card of cards.values()) card.questions = sortQuestions(card.questions);
  const sorted = [...cards.values()].sort(compareCards);
  return {
    active: sorted.filter((c) => !isStale(c.ticket)),
    stale: sorted.filter((c) => isStale(c.ticket)),
  };
}

/**
 * The inbox right after a question is answered, before the refetch lands: the question leaves,
 * and its ticket too once nothing on it is open (the API clears the flag the same way).
 */
export function withoutQuestion(data: NeedsYou, questionId: string): NeedsYou {
  const answered = data.questions.find((q) => q.id === questionId);
  if (!answered) return data;
  const questions = data.questions.filter((q) => q.id !== questionId);
  const stillOpen = questions.some((q) => q.ticketId === answered.ticketId);
  return {
    questions,
    tickets: stillOpen ? data.tickets : data.tickets.filter((t) => t.id !== answered.ticketId),
  };
}
