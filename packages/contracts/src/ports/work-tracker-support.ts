import type { EventActor, Project, Question, Ticket, TicketEvent } from "../entities";
import { QuestionId } from "../entities";
import {
  NewProject,
  NewQuestion,
  NewTicket,
  TicketChange,
  WorkTrackerError,
  type TicketFields,
} from "./index";

/**
 * Pure helpers shared by every WorkTracker adapter, so they build records and history the
 * same way. Adapters own only storage and atomicity.
 */

export function projectIdFor(key: string): string {
  return key.toLowerCase();
}

export function buildProject(input: NewProject): Project {
  const p = NewProject.parse(input);
  return {
    ...p,
    id: projectIdFor(p.key),
    gcpDevProjectId: null,
    gcpProdProjectId: null,
    monthlyBudgetUsd: null,
    enabled: true,
    autoRefine: true,
  };
}

/** Rank sorts lexically; zero-padded ticket numbers keep creation order until M4: Epics + story board adds reordering. */
export function rankFor(ticketNumber: number): string {
  return String(ticketNumber).padStart(10, "0");
}

/**
 * Rank order: plain code-unit comparison, never `localeCompare`, whose order depends on the
 * locale. Every place that sorts tickets uses this, so the board, the API and storage agree.
 */
export function compareRanks(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

let lastMs = 0;
let sameMsSeq = 0;

/**
 * Event ids sort in write order: zero-padded epoch ms, then a per-process sequence for writes
 * in the same millisecond, then a random suffix so two instances never collide. Order across
 * instances within one millisecond is arbitrary (fine for a single user).
 */
export function eventId(at: Date): string {
  const ms = at.getTime();
  sameMsSeq = ms === lastMs ? sameMsSeq + 1 : 0;
  lastMs = ms;
  const seq = String(sameMsSeq).padStart(6, "0");
  return `${String(ms).padStart(15, "0")}-${seq}-${crypto.randomUUID().slice(0, 8)}`;
}

export function event(
  ticket: Pick<Ticket, "id">,
  kind: TicketEvent["kind"],
  actor: EventActor,
  at: Date,
  body: string | null,
  data: Record<string, unknown> = {},
): TicketEvent {
  const runId = actor.startsWith("agent:") ? actor.slice("agent:".length) : null;
  return {
    id: eventId(at),
    ticketId: ticket.id,
    kind,
    actor,
    runId,
    body,
    data,
    createdAt: at.toISOString(),
  };
}

export function buildTicket(
  project: Project,
  ticketNumber: number,
  input: NewTicket,
  actor: EventActor,
  at: Date,
): { ticket: Ticket; events: TicketEvent[] } {
  const t = NewTicket.parse(input);
  const now = at.toISOString();
  const ticket: Ticket = {
    ...t,
    id: crypto.randomUUID(),
    projectId: project.id,
    key: `${project.key}-${ticketNumber}`,
    stage: "backlog",
    rank: rankFor(ticketNumber),
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  return { ticket, events: [event(ticket, "created", actor, at, null, { key: ticket.key })] };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Applies a change; returns the new ticket and its events (none when nothing changed). */
export function applyTicketChange(
  current: Ticket,
  input: TicketChange,
  actor: EventActor,
  at: Date,
): { ticket: Ticket; events: TicketEvent[] } {
  const change = TicketChange.parse(input);
  if (change.ifUpdatedAt && change.ifUpdatedAt !== current.updatedAt) {
    throw new WorkTrackerError("conflict", `ticket ${current.key} changed since it was read`);
  }

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, to] of Object.entries(change.fields) as [keyof TicketFields, unknown][]) {
    if (to !== undefined && !same(current[field], to)) diff[field] = { from: current[field], to };
  }

  const events: TicketEvent[] = [];
  let next: Ticket = { ...current };
  if (Object.keys(diff).length > 0) {
    next = { ...next, ...change.fields };
    events.push(event(current, "fields_changed", actor, at, null, { diff }));
  }
  if (change.stage && change.stage.to !== current.stage) {
    const { to, forced, reason } = change.stage;
    events.push(
      event(current, "stage_changed", actor, at, reason, {
        from: current.stage,
        to,
        forced,
      }),
    );
    next.stage = to;
  }
  if (events.length > 0) next.updatedAt = at.toISOString();
  return { ticket: next, events };
}

/**
 * A new open question. With `runId` (questions an agent run asked) the id is derived from the
 * run and the question's position, so writing the same run's questions twice hits the same ids.
 */
export function buildQuestion(
  ticket: Ticket,
  input: NewQuestion,
  at: Date,
  from: { runId: string; index: number } | null = null,
): Question {
  const q = NewQuestion.parse(input);
  return {
    ...q,
    // Parsed so a run id that can't form a sendable question id fails here, not when Andy answers.
    id: QuestionId.parse(from ? runQuestionId(from.runId, from.index) : crypto.randomUUID()),
    runId: from?.runId ?? null,
    projectId: ticket.projectId,
    ticketId: ticket.id,
    status: "open",
    answer: null,
    answeredVia: null,
    createdAt: at.toISOString(),
    answeredAt: null,
  };
}

/** Id of a run's n-th question (0-based); deterministic, so per-run writes are idempotent. */
export function runQuestionId(runId: string, index: number): string {
  return `${runId}-q${index + 1}`;
}

export function notFound(what: string, id: string): WorkTrackerError {
  return new WorkTrackerError("not_found", `${what} not found: ${id}`);
}
