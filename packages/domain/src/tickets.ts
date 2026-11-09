import {
  NewTicket,
  REFINE_LIMITS,
  Stage,
  compareRanks,
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
import { MAX_OPEN_QUESTIONS_PER_TICKET } from "./refine-gate";
import { rankBetween } from "./ranks";
import { canTransition, isForwardMove, pullRequestPath, type PullRequestTarget } from "./stages";

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
      | "not_buildable"
      | "run_limit"
      | "run_finished"
      | "executor_unavailable"
      | "dispatch_failed"
      | "cancel_failed"
      | "plan_not_decidable"
      | "not_promotable",
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

/** How many concurrent writes a PR walk re-reads past before it gives up (ADR-0067). */
export const PULL_REQUEST_CONFLICT_RETRIES = 3;

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
     * Starts the next waiting run when one may be waiting (the build and refine dispatchers,
     * ADR-0063, ADR-0075): after a ticket enters Up next, after its last open question is
     * answered, after a ticket reaches Ready, and after a cancel stops a run. It never throws.
     */
    private readonly dispatchNext: ((projectId: string) => Promise<unknown>) | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** A new ticket lands in Ideas and costs nothing, unless `upNext` pulls it forward (ADR-0075). */
  async create(
    projectId: string,
    input: NewTicket,
    actor: EventActor,
    { upNext = false }: { upNext?: boolean } = {},
  ): Promise<Ticket> {
    const parsed = NewTicket.parse(input);
    if (upNext && parsed.type === "epic") {
      throw new DomainError("invalid_transition", "epics are never refined, so never Up next");
    }
    const dorStatus = checkDor(parsed, 0).met ? "met" : "not_met";
    const ticket = await this.tracker.createTicket(projectId, { ...parsed, dorStatus }, actor);
    return upNext ? this.setUpNext(projectId, ticket.id, { upNext: true }, actor) : ticket;
  }

  /**
   * Moves a Backlog ticket between Ideas and Up next, or reorders it in Up next (ADR-0075).
   * Entering is the refine trigger. Leaving withdraws its open questions: refine asks afresh on
   * the next entry, and a promoted assumption goes back to being an assumption.
   */
  async setUpNext(
    projectId: string,
    ticketId: string,
    { upNext, rank = null }: { upNext: boolean; rank?: string | null },
    actor: EventActor,
  ): Promise<Ticket> {
    const ticket = await this.require(projectId, ticketId);
    if (ticket.stage !== "backlog") {
      throw new DomainError("invalid_transition", `${ticket.key} is not in Backlog`);
    }
    if (ticket.type === "epic") {
      throw new DomainError("invalid_transition", "epics are never refined, so never Up next");
    }
    const inUpNext = ticket.upNextRank !== null;
    if (!upNext) {
      if (!inUpNext) return ticket;
      await this.withdrawOpenQuestions(ticketId, actor);
      return this.tracker.updateTicket(
        projectId,
        ticketId,
        {
          fields: {
            upNextRank: null,
            upNextAt: null,
            needsAttention: false,
            refineAssumptions: ticket.refineAssumptions.map((a) =>
              a.status === "promoted" ? { ...a, status: "assumed", questionId: null } : a,
            ),
          },
          ifUpdatedAt: ticket.updatedAt,
        },
        actor,
      );
    }
    if (inUpNext) {
      if (!rank) return ticket;
      return this.tracker.updateTicket(
        projectId,
        ticketId,
        { fields: { upNextRank: rank }, ifUpdatedAt: ticket.updatedAt },
        actor,
      );
    }
    const open = await this.openQuestionCount(ticketId);
    const entered = await this.tracker.updateTicket(
      projectId,
      ticketId,
      {
        fields: {
          upNextRank: rank ?? (await this.endOfUpNext(projectId)),
          upNextAt: this.now().toISOString(),
          sentBackReason: null,
          // Pulling it forward is Andy's decision, so an old flag doesn't hold it back.
          needsAttention: open > 0,
        },
        ifUpdatedAt: ticket.updatedAt,
      },
      actor,
    );
    await this.dispatchNext?.(projectId);
    return entered;
  }

  private async endOfUpNext(projectId: string): Promise<string> {
    const ranks = (await this.tracker.listTickets(projectId, { stage: "backlog" }))
      .flatMap((t) => t.upNextRank ?? [])
      .sort(compareRanks);
    return rankBetween(ranks.at(-1) ?? null, null);
  }

  /**
   * Andy turns one of refine's assumptions into a question (ADR-0075). A Ready ticket goes back
   * to Up next, so it can't be built around the open question; once a build has started, it's too
   * late. Promoted questions don't count against the daily cap: Andy is spending his own time.
   */
  async promoteAssumption(
    projectId: string,
    ticketId: string,
    assumptionId: string,
    actor: EventActor,
  ): Promise<Question> {
    const ticket = await this.require(projectId, ticketId);
    const assumption = ticket.refineAssumptions.find((a) => a.id === assumptionId);
    if (!assumption) throw notFound("assumption", assumptionId);
    if (assumption.status !== "assumed") {
      throw new DomainError("not_promotable", `that assumption is already ${assumption.status}`);
    }
    if (ticket.stage !== "backlog" && ticket.stage !== "ready") {
      throw new DomainError("not_promotable", `${ticket.key} is already ${ticket.stage}`);
    }
    const open = await this.openQuestionCount(ticketId);
    if (open >= MAX_OPEN_QUESTIONS_PER_TICKET) {
      throw new DomainError("not_promotable", `${ticket.key} has ${open} open questions`, [
        "answer one first",
      ]);
    }
    const question = await this.tracker.askQuestion(
      projectId,
      ticketId,
      {
        text: assumption.question,
        options: assumption.options,
        suggestedAnswer: assumption.text.slice(0, REFINE_LIMITS.option),
        assumptions: [assumption.text],
      },
      actor,
    );
    try {
      await this.tracker.updateTicket(
        projectId,
        ticketId,
        {
          fields: {
            needsAttention: true,
            dorStatus: "not_met",
            refineAssumptions: ticket.refineAssumptions.map((a) =>
              a.id === assumptionId ? { ...a, status: "promoted", questionId: question.id } : a,
            ),
            ...(ticket.upNextRank === null
              ? { upNextRank: await this.endOfUpNext(projectId) }
              : {}),
          },
          ...(ticket.stage === "ready"
            ? { stage: { to: "backlog" as const, forced: false, reason: "Assumption promoted" } }
            : {}),
          ifUpdatedAt: ticket.updatedAt,
        },
        "system",
      );
    } catch (err) {
      await this.tracker.withdrawQuestion(question.id, "system");
      throw err;
    }
    return question;
  }

  /** The MCP form of `promoteAssumption`. */
  async promoteAssumptionByKey(key: string, assumptionId: string, actor: EventActor) {
    const ticket = await this.findByKey(key);
    return this.promoteAssumption(ticket.projectId, ticket.id, assumptionId, actor);
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
    const moved = await this.tracker.updateTicket(
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
    // A ticket reaching Ready may be the next build (ADR-0063).
    if (to === "ready") await this.dispatchNext?.(projectId);
    return moved;
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
    await this.reportCancelledRuns(projectId, ticketId, cancelled, "with the ticket");
    return updated;
  }

  /** A comment per cancelled run; a cancelled run frees the run slot, so the next refine starts. */
  private async reportCancelledRuns(
    projectId: string,
    ticketId: string,
    cancelled: Run[],
    why: string,
  ): Promise<void> {
    for (const run of cancelled) {
      await this.tracker.addComment(
        projectId,
        ticketId,
        `Cancelled the ${run.step} run ${run.links.executorRun ?? run.id} ${why}.`,
        "system",
      );
    }
    // A cancelled run frees the project's run slot: the next waiting run can start.
    if (cancelled.length > 0) await this.dispatchNext?.(projectId);
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

  /**
   * ADR-0067: the named system move for a same-repo PR into the default branch. It walks the
   * ticket forward one step at a time as "system", unforced, with the PR link as the reason, and
   * skips only the Definition of Ready (the work exists). Epics, archived and Cancelled tickets
   * never move. A write that lands mid-walk (`conflict`) re-reads the ticket and carries on from
   * where it is, a few times at most: the delivery is recorded once, so nothing retries it later.
   * Reaching Done stops the ticket's runs, withdraws open questions and clears Needs-you, as
   * cancel does. Returns the stages moved through.
   */
  async followPullRequest(
    projectId: string,
    ticketId: string,
    to: PullRequestTarget,
    reason: string,
  ): Promise<Stage[]> {
    const moved: Stage[] = [];
    let ticket = await this.require(projectId, ticketId);
    for (let conflicts = 0; ;) {
      if (ticket.type === "epic" || ticket.archived) break;
      const next = pullRequestPath(ticket.stage, to)[0];
      if (!next) break;
      try {
        ticket = await this.tracker.updateTicket(
          projectId,
          ticketId,
          { stage: { to: next, forced: false, reason }, ifUpdatedAt: ticket.updatedAt },
          "system",
        );
        moved.push(next);
      } catch (err) {
        const conflict = err instanceof WorkTrackerError && err.code === "conflict";
        if (!conflict || ++conflicts > PULL_REQUEST_CONFLICT_RETRIES) throw err;
        ticket = await this.require(projectId, ticketId);
      }
    }
    if (to === "done" && moved.includes("done")) await this.completeByPullRequest(ticket);
    return moved;
  }

  /** After a merge reached Done: what cancel does to runs, questions and Needs-you. */
  private async completeByPullRequest(ticket: Ticket): Promise<void> {
    const runs = (await this.runs?.cancelForTicket(ticket.projectId, ticket.id)) ?? [];
    await this.withdrawOpenQuestions(ticket.id, "system");
    await this.tracker.updateTicket(
      ticket.projectId,
      ticket.id,
      { fields: { needsAttention: false } },
      "system",
    );
    await this.reportCancelledRuns(ticket.projectId, ticket.id, runs, "when its PR merged");
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
    // A promoted assumption's answer needs its own small re-refine before Ready (ADR-0075).
    const promotedGap = ticket.refineAssumptions.some((a) => a.questionId === question.id);
    await this.tracker.updateTicket(
      ticket.projectId,
      ticket.id,
      {
        fields: {
          needsAttention: open > 0,
          dorStatus: met ? "met" : "not_met",
          ...(promotedGap
            ? {
                refineAssumptions: ticket.refineAssumptions.map((a) =>
                  a.questionId === question.id
                    ? { ...a, status: "answered", answeredAt: question.answeredAt }
                    : a,
                ),
              }
            : {}),
        },
      },
      "system",
    );
    // Only Up next goes to Ready on an answer: an Idea hasn't passed the gate. Any answered gap,
    // not just this one, still needs its re-refine first.
    const gapWaiting = promotedGap || ticket.refineAssumptions.some((a) => a.status === "answered");
    if (met && !gapWaiting && ticket.upNextRank !== null && ticket.stage === "backlog") {
      await this.promote(ticket);
    } else if (open === 0 && ticket.stage === "backlog")
      await this.dispatchNext?.(ticket.projectId);
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
      // A flag left on a finished ticket (AI-2) isn't waiting on anyone, unless a question is open
      // (the inbox lists those under Stale).
      tickets: flagged
        .flat()
        .filter(
          (t) =>
            !hidden.has(t.id) && (t.stage !== "done" || questions.some((q) => q.ticketId === t.id)),
        ),
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
