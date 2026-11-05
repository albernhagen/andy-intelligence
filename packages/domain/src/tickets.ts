import {
  NewTicket,
  Stage,
  TicketKey,
  WorkTrackerError,
  notFound,
  type AnsweredVia,
  type EventActor,
  type NewQuestion,
  type Question,
  type Run,
  type Ticket,
  type TicketEvent,
  type TicketFields,
  type WorkTracker,
} from "@andy/contracts";
import { checkDor, type DorResult } from "./dor";
import { canTransition, isForwardMove } from "./stages";

function log(severity: "INFO" | "WARNING", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "tickets", ...fields }));
}

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
      | "not_refinable"
      | "run_limit"
      | "run_finished"
      | "executor_unavailable"
      | "dispatch_failed"
      | "cancel_failed",
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

/** Every project with its unarchived ticket count per stage, plus the size of the Needs-you inbox. */
export interface Overview {
  projects: { key: string; name: string; ticketsByStage: Record<Stage, number> }[];
  needsYou: { questions: number; tickets: number };
}

/** How many history events `status` returns, newest last. */
export const RECENT_EVENTS = 5;

/** Stages a ticket can be archived in (AI-15: Cancel and archive tickets). */
export const ARCHIVABLE_STAGES: readonly Stage[] = ["done", "cancelled"];

/** Stops a ticket's runs in flight before it is cancelled; RunService implements it. */
export interface RunCanceller {
  cancelForTicket(projectId: string, ticketId: string): Promise<Run[]>;
}

export interface MoveOptions {
  force?: boolean;
  reason?: string | null;
}

/**
 * Ticket rules on top of a WorkTracker: stage machine, Definition of Ready, Needs-you flag.
 * Derived fields (dorStatus, needsAttention) are written as a follow-up update by "system"; that
 * second write isn't atomic with the first, which is acceptable for a single user and is
 * corrected by the next change to the ticket.
 */
export class TicketService {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly runs: RunCanceller | null = null,
    /**
     * Starts refine when a ticket may be waiting for it (the refine dispatcher, ADR-0054):
     * after a create, after a ticket's last open question is answered, and after a cancel stops
     * a run. It never throws.
     */
    private readonly refineNext: ((projectId: string) => Promise<unknown>) | null = null,
  ) {}

  async create(projectId: string, input: NewTicket, actor: EventActor): Promise<Ticket> {
    const parsed = NewTicket.parse(input);
    const dorStatus = checkDor(parsed, 0).met ? "met" : "not_met";
    const ticket = await this.tracker.createTicket(projectId, { ...parsed, dorStatus }, actor);
    await this.refineNext?.(projectId);
    return ticket;
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
    if (to === "cancelled") {
      throw new DomainError("invalid_transition", "cancel the ticket instead of moving it");
    }
    if (ticket.stage === "cancelled" && actor !== "andy") {
      throw new DomainError("forbidden", "only Andy can reopen a cancelled ticket");
    }
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
    // Only Done or Cancelled tickets stay archived, so moving out of them unarchives.
    const unarchive = ticket.archived && !ARCHIVABLE_STAGES.includes(to);
    // A question that slipped in while the ticket was being cancelled is withdrawn on reopen,
    // before the stage changes, so a failure leaves the ticket cancelled (hidden) and retryable.
    const reopen = ticket.stage === "cancelled";
    if (reopen) await this.withdrawOpenQuestions(ticketId, actor);
    return this.tracker.updateTicket(
      projectId,
      ticketId,
      {
        fields: {
          ...(unarchive ? { archived: false } : {}),
          ...(reopen ? { needsAttention: false } : {}),
        },
        stage: { to, forced: force, reason: reason?.trim() || null },
        ifUpdatedAt: ticket.updatedAt,
      },
      actor,
    );
  }

  /**
   * Andy cancels a ticket from any stage. Its runs in flight are cancelled first; if that fails,
   * the stage doesn't change. Its open questions are withdrawn (kept in history) and Needs-you is
   * cleared; reopening doesn't bring them back. The reason, if given, goes in the stage event.
   */
  async cancel(
    projectId: string,
    ticketId: string,
    actor: EventActor,
    reason: string | null = null,
  ): Promise<Ticket> {
    if (actor !== "andy") throw new DomainError("forbidden", "only Andy can cancel a ticket");
    const ticket = await this.require(projectId, ticketId);
    if (ticket.stage === "cancelled") {
      throw new DomainError("invalid_transition", `${ticket.key} is already cancelled`);
    }
    const cancelled = (await this.runs?.cancelForTicket(projectId, ticketId)) ?? [];
    // Stage first, questions after: if withdrawing fails partway, the ticket is still cancelled
    // and `needsAttention()` already skips cancelled tickets. No `ifUpdatedAt`: cancel is valid from
    // any stage, so a write since the read (e.g. a run's report) mustn't fail it after the runs
    // are already stopped.
    const updated = await this.tracker.updateTicket(
      projectId,
      ticketId,
      {
        fields: { needsAttention: false },
        stage: { to: "cancelled", forced: false, reason: reason?.trim() || null },
      },
      actor,
    );
    await this.withdrawOpenQuestions(ticketId, actor);
    for (const run of cancelled) {
      await this.tracker.addComment(
        projectId,
        ticketId,
        `Cancelled the ${run.step} run ${run.links.executorRun ?? run.id} with the ticket.`,
        "system",
      );
    }
    // A cancelled run frees the project's run slot: the next waiting refine can start.
    if (cancelled.length > 0) await this.refineNext?.(projectId);
    return updated;
  }

  /** Andy archives (hides) a Done or Cancelled ticket, or unarchives any ticket. */
  async archive(
    projectId: string,
    ticketId: string,
    archived: boolean,
    actor: EventActor,
  ): Promise<Ticket> {
    if (actor !== "andy") throw new DomainError("forbidden", "only Andy can archive a ticket");
    const ticket = await this.require(projectId, ticketId);
    if (archived && !ARCHIVABLE_STAGES.includes(ticket.stage)) {
      throw new DomainError(
        "invalid_transition",
        `only Done or Cancelled tickets can be archived; ${ticket.key} is ${ticket.stage}`,
      );
    }
    return this.tracker.updateTicket(
      projectId,
      ticketId,
      { fields: { archived }, ifUpdatedAt: ticket.updatedAt },
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
      { fields: { needsAttention: open > 0 } },
      actor,
    );
  }

  /** Puts the ticket in the Needs-you inbox. */
  flag(projectId: string, ticketId: string, actor: EventActor): Promise<Ticket> {
    return this.tracker.updateTicket(
      projectId,
      ticketId,
      { fields: { needsAttention: true } },
      actor,
    );
  }

  comment(projectId: string, ticketId: string, body: string, actor: EventActor) {
    return this.tracker.addComment(projectId, ticketId, body, actor);
  }

  history(projectId: string, ticketId: string): Promise<TicketEvent[]> {
    return this.tracker.listEvents(projectId, ticketId);
  }

  /** An open question flags the ticket Needs-you and blocks Ready. Cancelled tickets take none. */
  async ask(
    projectId: string,
    ticketId: string,
    input: NewQuestion,
    actor: EventActor,
  ): Promise<Question> {
    const ticket = await this.require(projectId, ticketId);
    if (ticket.stage === "cancelled") {
      throw new DomainError("invalid_transition", `${ticket.key} is cancelled; reopen it first`);
    }
    const question = await this.tracker.askQuestion(projectId, ticketId, input, actor);
    await this.tracker.updateTicket(
      projectId,
      ticketId,
      { fields: { needsAttention: true, dorStatus: "not_met" } },
      "system",
    );
    return question;
  }

  /**
   * Answering re-checks the Definition of Ready and clears Needs-you when nothing is open. The
   * last answer on a Backlog ticket that now meets the DoR moves it to Ready (ARCHITECTURE §4.1:
   * exit is automatic), as "system", through the same checks as any move. When the DoR is still
   * unmet, the refine dispatcher may run refine again with the answers.
   */
  async answer(
    questionId: string,
    answer: string,
    via: AnsweredVia,
    actor: EventActor,
  ): Promise<Question> {
    const question = await this.tracker.answerQuestion(questionId, answer, via, actor);
    const ticket = await this.require(question.projectId, question.ticketId);
    const open = await this.openQuestionCount(ticket.id);
    const met = checkDor(ticket, open).met;
    await this.tracker.updateTicket(
      ticket.projectId,
      ticket.id,
      { fields: { needsAttention: open > 0, dorStatus: met ? "met" : "not_met" } },
      "system",
    );
    if (met && ticket.stage === "backlog") await this.promote(ticket);
    else if (open === 0 && ticket.stage === "backlog") await this.refineNext?.(ticket.projectId);
    return question;
  }

  /**
   * Backlog → Ready by "system". `move` re-reads the ticket, re-checks the DoR and writes with
   * `ifUpdatedAt`, so an edit that lands meanwhile wins; the answer stands either way and Andy
   * can still move the ticket himself.
   */
  private async promote(ticket: Ticket): Promise<void> {
    try {
      await this.move(ticket.projectId, ticket.id, "ready", "system");
      log("INFO", "ticket moved to ready after its last answer", { ticket: ticket.key });
    } catch (err) {
      const conflict = err instanceof WorkTrackerError && err.code === "conflict";
      if (!conflict && !(err instanceof DomainError)) throw err;
      log("WARNING", "ticket not moved to ready after its last answer", {
        ticket: ticket.key,
        reason: err.message,
      });
    }
  }

  /**
   * The Needs-you inbox: open questions plus flagged tickets, across all projects. Archived and
   * cancelled tickets are left out, so a question that slips past a cancel never shows.
   */
  async needsYou(): Promise<{ questions: Question[]; tickets: Ticket[] }> {
    const projects = await this.tracker.listProjects();
    const [questions, flagged, archived, cancelled] = await Promise.all([
      this.tracker.listQuestions({ status: "open" }),
      Promise.all(
        projects.map((p) =>
          this.tracker.listTickets(p.id, { needsAttention: true, archived: false }),
        ),
      ),
      Promise.all(projects.map((p) => this.tracker.listTickets(p.id, { archived: true }))),
      Promise.all(projects.map((p) => this.tracker.listTickets(p.id, { stage: "cancelled" }))),
    ]);
    const hidden = new Set([...archived.flat(), ...cancelled.flat()].map((t) => t.id));
    return {
      questions: questions.filter((q) => !hidden.has(q.ticketId)),
      tickets: flagged.flat().filter((t) => !hidden.has(t.id)),
    };
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
        for (const t of await this.tracker.listTickets(p.id, { archived: false })) {
          ticketsByStage[t.stage]++;
        }
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

  /** A question answered meanwhile is skipped (`conflict`); it is no longer open either way. */
  private async withdrawOpenQuestions(ticketId: string, actor: EventActor): Promise<void> {
    for (const q of await this.tracker.listQuestions({ ticketId, status: "open" })) {
      try {
        await this.tracker.withdrawQuestion(q.id, actor);
      } catch (err) {
        if (!(err instanceof WorkTrackerError && err.code === "conflict")) throw err;
      }
    }
  }

  private async openQuestionCount(ticketId: string): Promise<number> {
    return (await this.tracker.listQuestions({ ticketId, status: "open" })).length;
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
