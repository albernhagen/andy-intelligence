import {
  NewTicket,
  Stage,
  TicketKey,
  notFound,
  type AnsweredVia,
  type EventActor,
  type NewQuestion,
  type Question,
  type Ticket,
  type TicketEvent,
  type TicketFields,
  type WorkTracker,
} from "@andy/contracts";
import { checkDor, type DorResult } from "./dor";
import { canTransition, isForwardMove } from "./stages";

/** A rule violation the caller caused; the API maps codes to HTTP statuses. */
export class DomainError extends Error {
  constructor(
    readonly code:
      | "invalid_transition"
      | "dor_not_met"
      | "forbidden"
      | "invalid_repo"
      | "repo_taken"
      | "invalid_step"
      | "run_limit"
      | "run_finished"
      | "executor_unavailable"
      | "dispatch_failed",
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/** Fields callers may edit; `dorStatus` is always computed here. */
export type EditableFields = Omit<TicketFields, "dorStatus">;

/** One ticket at a glance: where it is, what blocks Ready, and what happened lately. */
export interface TicketStatus {
  ticket: Ticket;
  readiness: DorResult;
  questions: Question[];
  recentEvents: TicketEvent[];
}

/** Every project with its ticket count per stage, plus the size of the Needs-you inbox. */
export interface Overview {
  projects: { key: string; name: string; ticketsByStage: Record<Stage, number> }[];
  needsYou: { questions: number; tickets: number };
}

/** How many history events `status` returns, newest last. */
export const RECENT_EVENTS = 5;

export interface MoveOptions {
  force?: boolean;
  reason?: string | null;
}

/**
 * Ticket rules on top of a WorkTracker: stage machine, Definition of Ready, Needs-you flag.
 * Derived fields (dorStatus, needsYou) are written as a follow-up update by "system"; that
 * second write isn't atomic with the first, which is acceptable for a single user and is
 * corrected by the next change to the ticket.
 */
export class TicketService {
  constructor(private readonly tracker: WorkTracker) {}

  async create(projectId: string, input: NewTicket, actor: EventActor): Promise<Ticket> {
    const parsed = NewTicket.parse(input);
    const dorStatus = checkDor(parsed, 0).met ? "met" : "not_met";
    return this.tracker.createTicket(projectId, { ...parsed, dorStatus }, actor);
  }

  async update(
    projectId: string,
    ticketId: string,
    fields: EditableFields,
    actor: EventActor,
    ifUpdatedAt?: string,
  ): Promise<Ticket> {
    const current = await this.require(projectId, ticketId);
    const merged = { ...current, ...stripUndefined(fields) };
    const dor = checkDor(merged, await this.openQuestionCount(ticketId));
    return this.tracker.updateTicket(
      projectId,
      ticketId,
      { fields: { ...fields, dorStatus: dor.met ? "met" : "not_met" }, ifUpdatedAt },
      actor,
    );
  }

  async readiness(projectId: string, ticketId: string): Promise<DorResult> {
    const ticket = await this.require(projectId, ticketId);
    return checkDor(ticket, await this.openQuestionCount(ticketId));
  }

  async move(
    projectId: string,
    ticketId: string,
    to: Stage,
    actor: EventActor,
    { force = false, reason = null }: MoveOptions = {},
  ): Promise<Ticket> {
    const ticket = await this.require(projectId, ticketId);
    if (force) {
      // ADR-0057: the reason is optional; `forced: true` in history is the audit trail.
      if (actor !== "andy") throw new DomainError("forbidden", "only Andy can force a stage move");
    } else {
      if (!canTransition(ticket.stage, to)) {
        throw new DomainError("invalid_transition", `can't move from ${ticket.stage} to ${to}`);
      }
      if (ticket.stage === "backlog" && to === "ready") {
        const dor = checkDor(ticket, await this.openQuestionCount(ticketId));
        if (!dor.met) {
          throw new DomainError("dor_not_met", "Definition of Ready not met", dor.missing);
        }
      }
    }
    return this.tracker.updateTicket(
      projectId,
      ticketId,
      {
        stage: { to, forced: force, reason: reason?.trim() || null },
        ifUpdatedAt: ticket.updatedAt,
      },
      actor,
    );
  }

  /** One step forward by ticket key, never forced (the MCP `move_ticket` tool). */
  async moveForward(key: string, to: Stage, actor: EventActor): Promise<Ticket> {
    const ticket = await this.findByKey(key);
    if (!isForwardMove(ticket.stage, to)) {
      throw new DomainError(
        "invalid_transition",
        `can't move ${key} from ${ticket.stage} to ${to}: only one step forward is allowed`,
      );
    }
    return this.move(ticket.projectId, ticket.id, to, actor);
  }

  /** Takes the ticket out of the Needs-you inbox unless a question is still open. */
  async unflag(projectId: string, ticketId: string, actor: EventActor): Promise<Ticket> {
    const open = await this.openQuestionCount(ticketId);
    return this.tracker.updateTicket(
      projectId,
      ticketId,
      { fields: { needsYou: open > 0 } },
      actor,
    );
  }

  /** Puts the ticket in the Needs-you inbox. */
  flag(projectId: string, ticketId: string, actor: EventActor): Promise<Ticket> {
    return this.tracker.updateTicket(projectId, ticketId, { fields: { needsYou: true } }, actor);
  }

  comment(projectId: string, ticketId: string, body: string, actor: EventActor) {
    return this.tracker.addComment(projectId, ticketId, body, actor);
  }

  history(projectId: string, ticketId: string): Promise<TicketEvent[]> {
    return this.tracker.listEvents(projectId, ticketId);
  }

  /** An open question flags the ticket Needs-you and blocks Ready. */
  async ask(
    projectId: string,
    ticketId: string,
    input: NewQuestion,
    actor: EventActor,
  ): Promise<Question> {
    const question = await this.tracker.askQuestion(projectId, ticketId, input, actor);
    await this.tracker.updateTicket(
      projectId,
      ticketId,
      { fields: { needsYou: true, dorStatus: "not_met" } },
      "system",
    );
    return question;
  }

  /** Answering re-checks the Definition of Ready and clears Needs-you when nothing is open. */
  async answer(
    questionId: string,
    answer: string,
    via: AnsweredVia,
    actor: EventActor,
  ): Promise<Question> {
    const question = await this.tracker.answerQuestion(questionId, answer, via, actor);
    const ticket = await this.require(question.projectId, question.ticketId);
    const open = await this.openQuestionCount(ticket.id);
    await this.tracker.updateTicket(
      ticket.projectId,
      ticket.id,
      { fields: { needsYou: open > 0, dorStatus: checkDor(ticket, open).met ? "met" : "not_met" } },
      "system",
    );
    return question;
  }

  /** The Needs-you inbox: open questions plus flagged tickets, across all projects. */
  async needsYou(): Promise<{ questions: Question[]; tickets: Ticket[] }> {
    const projects = await this.tracker.listProjects();
    const [questions, ...flagged] = await Promise.all([
      this.tracker.listQuestions({ status: "open" }),
      ...projects.map((p) => this.tracker.listTickets(p.id, { needsYou: true })),
    ]);
    return { questions, tickets: flagged.flat() };
  }

  /** "AI-42" → the ticket. A project's id is its key lowercased (WorkTracker contract). */
  async findByKey(key: string): Promise<Ticket> {
    if (!TicketKey.safeParse(key).success) throw notFound("ticket", key);
    const projectId = key.slice(0, key.lastIndexOf("-")).toLowerCase();
    const ticket = (await this.tracker.listTickets(projectId)).find((t) => t.key === key);
    if (!ticket) throw notFound("ticket", key);
    return ticket;
  }

  async status(key: string): Promise<TicketStatus> {
    const ticket = await this.findByKey(key);
    const [questions, events] = await Promise.all([
      this.tracker.listQuestions({ ticketId: ticket.id }),
      this.tracker.listEvents(ticket.projectId, ticket.id),
    ]);
    const open = questions.filter((q) => q.status === "open").length;
    return {
      ticket,
      readiness: checkDor(ticket, open),
      questions,
      recentEvents: events.slice(-RECENT_EVENTS),
    };
  }

  async overview(): Promise<Overview> {
    const [projects, inbox] = await Promise.all([this.tracker.listProjects(), this.needsYou()]);
    const counted = await Promise.all(
      projects.map(async (p) => {
        const ticketsByStage = Object.fromEntries(Stage.options.map((s) => [s, 0])) as Record<
          Stage,
          number
        >;
        for (const t of await this.tracker.listTickets(p.id)) ticketsByStage[t.stage]++;
        return { key: p.key, name: p.name, ticketsByStage };
      }),
    );
    return {
      projects: counted,
      needsYou: { questions: inbox.questions.length, tickets: inbox.tickets.length },
    };
  }

  private async require(projectId: string, ticketId: string): Promise<Ticket> {
    const ticket = await this.tracker.getTicket(projectId, ticketId);
    if (!ticket) throw notFound("ticket", ticketId);
    return ticket;
  }

  private async openQuestionCount(ticketId: string): Promise<number> {
    return (await this.tracker.listQuestions({ ticketId, status: "open" })).length;
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
