import {
  NewTicket,
  Stage,
  compareRanks,
  TicketKey,
  WorkTrackerError,
  notFound,
  type AnsweredVia,
  type EventActor,
  type ExecutorKind,
  type ExecutorView,
  type NewQuestion,
  type Project,
  type Question,
  type Run,
  type Ticket,
  type TicketEvent,
  type TicketFields,
  type Worker,
  type WorkerChoice,
  type WorkerView,
  type WorkTracker,
} from "@andy/contracts";
import { checkDor, heldGaps, isHeld, type DorResult } from "./dor";
import { DomainError } from "./errors";
import { requireCan } from "./permissions";
import { inboxCards } from "./inbox-order";
import {
  blockerKeys,
  blockerProblem,
  parentProblem,
  projectOfKey,
  reorderRank,
  ticketsByRef,
  type ReorderAnchor,
} from "./ticket-edits";
import { MAX_OPEN_QUESTIONS_PER_TICKET, assumptionQuestion } from "./refine-gate";
import { rankBetween } from "./ranks";
import { isDispatchable, resolveWorker, workerView } from "./worker";
import { cascadesFrom, epicOf, withEpicOverrides } from "./overrides";
import { executorView } from "./executor";
import { canTransition, isForwardMove, pullRequestPath, type PullRequestTarget } from "./stages";

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "tickets", ...fields }));
}

export { DomainError } from "./errors";

/** Fields callers may edit; `dorStatus` is always computed here. */
export type EditableFields = Omit<TicketFields, "dorStatus">;

/** One ticket at a glance: where it is, what blocks Ready, and what happened lately. */
export interface TicketStatus {
  ticket: Ticket;
  readiness: DorResult;
  questions: Question[];
  recentEvents: TicketEvent[];
  worker: Worker;
  /** Where its runs execute (ADR-0089), before runner presence is considered. */
  executor: ExecutorView;
}

/** Every project with its unarchived ticket count per stage, plus the size of the Needs-you inbox. */
export interface Overview {
  projects: {
    key: string;
    name: string;
    ticketsByStage: Record<Stage, number>;
    dispatch: Pick<Project, "runsAtOnce" | "paused" | "lastDispatch">;
  }[];
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
    /** Whether a local runner serving the project is present (ADR-0089); null: none can be. */
    private readonly runnerPresence: ((projectId: string) => Promise<boolean>) | null = null,
  ) {}

  private async runnerPresent(projectId: string): Promise<boolean> {
    return this.runnerPresence ? this.runnerPresence(projectId) : false;
  }

  /** A new ticket lands in Ideas and costs nothing, unless `upNext` pulls it forward (ADR-0075). */
  async create(
    projectId: string,
    input: NewTicket,
    actor: EventActor,
    { upNext = false }: { upNext?: boolean } = {},
  ): Promise<Ticket> {
    const parsed = NewTicket.parse(input);
    const parentId = parsed.parentId && (await this.parentIdOf(projectId, parsed.parentId));
    const dorStatus = checkDor(parsed, 0).met ? "met" : "not_met";
    const ticket = await this.tracker.createTicket(
      projectId,
      { ...parsed, parentId, dorStatus },
      actor,
    );
    return upNext ? this.setUpNext(projectId, ticket.id, { upNext: true }, actor) : ticket;
  }

  /**
   * A new ticket's parent, given as a key or an id (AI-130): the epic's id, or a refusal, as
   * `reparentByKey` and `update` refuse. A new ticket has no children, so no cycle check.
   */
  private async parentIdOf(projectId: string, parent: string): Promise<string> {
    const tickets = await this.tracker.listTickets(projectId);
    const found = tickets.find((t) => t.id === parent || t.key === parent);
    if (!found) throw new DomainError("invalid_reference", `${parent} is not in this project`);
    if (found.type !== "epic") {
      throw new DomainError("invalid_reference", `${found.key} is not an epic`);
    }
    return found.id;
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
    requireCan(actor, "promote_assumption", projectId);
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
      assumptionQuestion(assumption),
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

  /**
   * Andy lets a held gap (AI-75, ADR-0087) stand as an assumption, which releases the ticket to
   * the Definition of Ready check: with nothing else missing it goes to Ready, as an answer does.
   * Only a held gap needs this; any other assumption already stands.
   */
  async acceptAssumption(
    projectId: string,
    ticketId: string,
    assumptionId: string,
    actor: EventActor,
  ): Promise<Ticket> {
    requireCan(actor, "accept_assumption", projectId);
    const ticket = await this.require(projectId, ticketId);
    const assumption = ticket.refineAssumptions.find((a) => a.id === assumptionId);
    if (!assumption) throw notFound("assumption", assumptionId);
    if (!isHeld(assumption)) {
      throw new DomainError("not_acceptable", "only a held gap waits to be accepted", [
        `that assumption is ${assumption.status}${assumption.demotedBy ? "" : " and not held by a cap"}`,
      ]);
    }
    if (ticket.stage !== "backlog") {
      throw new DomainError("not_acceptable", `${ticket.key} is already ${ticket.stage}`);
    }
    const refineAssumptions = ticket.refineAssumptions.map((a) =>
      a.id === assumptionId ? { ...a, status: "accepted" as const } : a,
    );
    const open = await this.openQuestionCount(ticketId);
    const met = checkDor({ ...ticket, refineAssumptions }, open).met;
    // An answered gap still needs its re-refine: clear the flag so the dispatcher runs it.
    const gapWaiting = refineAssumptions.some((a) => a.status === "answered");
    const accepted = await this.tracker.updateTicket(
      projectId,
      ticketId,
      {
        fields: {
          refineAssumptions,
          dorStatus: met ? "met" : "not_met",
          needsAttention: open > 0 || (!met && !gapWaiting),
        },
        ifUpdatedAt: ticket.updatedAt,
      },
      actor,
    );
    log("INFO", "held gap accepted", { ticket: ticket.key, assumptionId });
    if (met && !gapWaiting && accepted.upNextRank !== null) {
      await this.promote(accepted);
    } else if (open === 0) await this.dispatchNext?.(projectId);
    return this.require(projectId, ticketId);
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
    if (fields.parentId && fields.parentId !== current.parentId) {
      const tickets = await this.tracker.listTickets(projectId);
      const problem = parentProblem(current, fields.parentId, tickets);
      if (problem) throw new DomainError("invalid_reference", problem);
    }
    if (fields.blockedBy) {
      fields = { ...fields, blockedBy: await this.checkedBlockers(current, fields.blockedBy) };
    }
    const merged = { ...current, ...stripUndefined(fields) };
    const dor = checkDor(merged, await this.openQuestionCount(ticketId));
    const updated = await this.tracker.updateTicket(
      projectId,
      ticketId,
      { fields: { ...fields, dorStatus: dor.met ? "met" : "not_met" }, ifUpdatedAt },
      actor,
    );
    // AI-116: an epic's overrides cascade, so an edit may free its Ready children to build.
    if (current.type === "epic" && fields.overrides !== undefined) {
      await this.dispatchNext?.(projectId);
    }
    return updated;
  }

  /**
   * The blockers to store, as keys of tickets in any project (AI-96). A new entry must name a
   * ticket (`not_found` otherwise) and mustn't close a cycle; an entry already on the ticket stays
   * even if its ticket is gone, so it can still be removed.
   */
  private async checkedBlockers(ticket: Ticket, blockedBy: readonly string[]): Promise<string[]> {
    const added = blockedBy.filter((ref) => !ticket.blockedBy.includes(ref));
    const byRef = await this.blockerGraph(ticket, added);
    const missing = added.find((ref) => !byRef.has(ref));
    if (missing) throw notFound("ticket", missing);
    const problem = blockerProblem(ticket, blockedBy, byRef);
    if (problem) throw new DomainError("invalid_reference", problem);
    return blockerKeys(blockedBy, byRef);
  }

  /**
   * Every ticket of the ticket's project and of each project a blocker chain from `refs` reaches,
   * by key and by id. Reads each project once; an unknown prefix reads as an empty project.
   */
  private async blockerGraph(
    ticket: Ticket,
    refs: readonly string[],
  ): Promise<Map<string, Ticket>> {
    const byRef = new Map<string, Ticket>();
    const read = new Set<string>();
    let pending = [ticket.projectId, ...refs.flatMap((r) => projectOfKey(r) ?? [])];
    while (pending.length > 0) {
      const next: string[] = [];
      for (const projectId of new Set(pending)) {
        if (read.has(projectId)) continue;
        read.add(projectId);
        const tickets = await this.tracker.listTickets(projectId);
        for (const [ref, t] of ticketsByRef(tickets)) byRef.set(ref, t);
        next.push(...tickets.flatMap((t) => t.blockedBy.flatMap((r) => projectOfKey(r) ?? [])));
      }
      pending = next.filter((p) => !read.has(p));
    }
    return byRef;
  }

  /**
   * A ticket reached Done: wakes each other project with a Ready ticket it blocks, so its
   * dispatcher can start the ticket once this was the last blocker (AI-96). The dispatcher
   * re-checks every blocker. Never throws: the move stands either way.
   */
  private async wakeDependents(done: Ticket): Promise<void> {
    if (!this.dispatchNext) return;
    try {
      for (const project of await this.tracker.listProjects()) {
        if (project.id === done.projectId) continue;
        const ready = await this.tracker.listTickets(project.id, { stage: "ready" });
        if (ready.some((t) => !t.archived && t.blockedBy.includes(done.key))) {
          log("INFO", "blocker done, waking dependent project", {
            ticket: done.key,
            projectId: project.id,
          });
          await this.dispatchNext(project.id);
        }
      }
    } catch (err) {
      log("ERROR", "waking dependent projects failed", { ticket: done.key, error: String(err) });
    }
  }

  /** Who does the ticket's work (ADR-0082). */
  async worker(projectId: string, ticketId: string): Promise<WorkerView> {
    const [ticket, project] = await Promise.all([
      this.require(projectId, ticketId),
      this.requireProject(projectId),
    ]);
    return workerView(ticket, project, await this.epicFor(ticket));
  }

  /** The ticket's epic when its overrides cascade (AI-116); one read when it has a parent. */
  private async epicFor(ticket: Ticket): Promise<Ticket | null> {
    if (!ticket.parentId) return null;
    return cascadesFrom(await this.tracker.getTicket(ticket.projectId, ticket.parentId));
  }

  /** The resolved worker of each ticket, by id; reads each project once. */
  async workersFor(tickets: Ticket[]): Promise<Map<string, Worker>> {
    const ids = [...new Set(tickets.map((t) => t.projectId))];
    const projects = new Map(
      await Promise.all(ids.map(async (id) => [id, await this.requireProject(id)] as const)),
    );
    // AI-116: a child takes its epic's pick, so read parents the list doesn't hold (once each).
    const listed = new Set(tickets.map((t) => t.id));
    const missing = [
      ...new Map(
        tickets
          .filter((t) => t.parentId && !listed.has(t.parentId))
          .map((t) => [t.parentId!, t.projectId] as const),
      ),
    ];
    const parents = await Promise.all(missing.map(([id, p]) => this.tracker.getTicket(p, id)));
    const pool = [...tickets, ...parents.filter((p): p is Ticket => p !== null)];
    return new Map(
      tickets.map((t) => [
        t.id,
        resolveWorker(withEpicOverrides(t, epicOf(t, pool)), projects.get(t.projectId)!),
      ]),
    );
  }

  /**
   * Stores the ticket's own pick, or clears it (null). A switch to an agent may free the ticket
   * for the dispatcher. A run already in flight is left alone (out of scope, ADR-0082).
   */
  async setWorker(
    projectId: string,
    ticketId: string,
    worker: WorkerChoice | null,
    actor: EventActor,
  ): Promise<WorkerView> {
    requireCan(actor, "set_worker", projectId);
    const [ticket, project] = await Promise.all([
      this.require(projectId, ticketId),
      this.requireProject(projectId),
    ]);
    const overrides = { ...ticket.overrides };
    // A harness pin (e.g. `jules`) already is an agent: picking "agent" must not erase which one.
    const pinned = worker === "agent" && workerView(ticket, project).override === "agent";
    if (!pinned) {
      delete overrides.assignee;
      if (worker) overrides.assignee = worker;
    }
    const updated = await this.tracker.updateTicket(
      projectId,
      ticketId,
      { fields: { overrides }, ifUpdatedAt: ticket.updatedAt },
      actor,
    );
    const epic = await this.epicFor(updated);
    if (isDispatchable(updated, project, epic)) await this.dispatchNext?.(projectId);
    return workerView(updated, project, epic);
  }

  /** Where the ticket's runs execute (ADR-0089). */
  async executor(projectId: string, ticketId: string): Promise<ExecutorView> {
    const [ticket, project] = await Promise.all([
      this.require(projectId, ticketId),
      this.requireProject(projectId),
    ]);
    return executorView(ticket, project, await this.runnerPresent(projectId));
  }

  /**
   * Stores the ticket's executor pick (`overrides.executor`), or clears it (null). Owner-only
   * (`set_executor`). A run in flight keeps its executor; the pick applies to the next run. The
   * dispatchers are woken, since a ticket may have just become startable on either executor.
   */
  async setExecutor(
    projectId: string,
    ticketId: string,
    executor: ExecutorKind | null,
    actor: EventActor,
  ): Promise<ExecutorView> {
    requireCan(actor, "set_executor", projectId);
    const [ticket, project] = await Promise.all([
      this.require(projectId, ticketId),
      this.requireProject(projectId),
    ]);
    const overrides = { ...ticket.overrides };
    delete overrides.executor;
    if (executor) overrides.executor = executor;
    const updated = await this.tracker.updateTicket(
      projectId,
      ticketId,
      { fields: { overrides }, ifUpdatedAt: ticket.updatedAt },
      actor,
    );
    log("INFO", "ticket executor set", { ticket: ticket.key, executor, by: actor });
    await this.dispatchNext?.(projectId);
    return executorView(updated, project, await this.runnerPresent(projectId));
  }

  /** Re-parents by key: `parent` is an epic's key in the same project, or null for none. */
  async reparentByKey(key: string, parent: string | null, actor: EventActor): Promise<Ticket> {
    const ticket = await this.findByKey(key);
    let parentId: string | null = null;
    if (parent !== null) {
      const found = await this.tracker.getTicketByKey(ticket.projectId, parent);
      if (!found) throw new DomainError("invalid_reference", `${parent} is not in this project`);
      parentId = found.id;
    }
    return this.update(ticket.projectId, ticket.id, { parentId }, actor, ticket.updatedAt);
  }

  /** Places a ticket next to another in its lane; order is priority (ADR-0058). */
  async reorderByKey(key: string, anchor: ReorderAnchor, actor: EventActor): Promise<Ticket> {
    const ticket = await this.findByKey(key);
    const tickets = await this.tracker.listTickets(ticket.projectId);
    const placed = reorderRank(ticket, anchor, tickets);
    if (typeof placed === "string") throw new DomainError("invalid_reference", placed);
    return placed.lane === "up_next"
      ? this.setUpNext(ticket.projectId, ticket.id, { upNext: true, rank: placed.rank }, actor)
      : this.update(ticket.projectId, ticket.id, { rank: placed.rank }, actor, ticket.updatedAt);
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
    if (ticket.stage === "cancelled") requireCan(actor, "reopen_ticket", projectId);
    if (force) {
      // ADR-0057: the reason is optional; `forced: true` in history is the audit trail.
      requireCan(actor, "force_move", projectId);
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
    // A ticket reaching Ready may be the next build (ADR-0063); a PR that stopped waiting frees
    // room under the cap on PRs waiting for Andy (ADR-0079).
    if (to === "ready" || ticket.stage === "ready_for_review") {
      await this.dispatchNext?.(projectId);
    }
    if (to === "done") await this.wakeDependents(moved);
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
    requireCan(actor, "cancel_ticket", projectId);
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
        `Cancelled the ${run.step} task ${run.links.executorRun ?? run.id} ${why}.`,
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
    requireCan(actor, "archive_ticket", projectId);
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
    if (to === "done" && moved.includes("done")) {
      await this.completeByPullRequest(ticket);
      await this.wakeDependents(ticket);
    }
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
    const asked = await this.tracker.getQuestion(questionId);
    requireCan(actor, "answer_question", asked?.projectId ?? null);
    const question = await this.tracker.answerQuestion(questionId, answer, via, actor);
    const ticket = await this.require(question.projectId, question.ticketId);
    const open = await this.openQuestionCount(ticket.id);
    const met = checkDor(ticket, open).met;
    // A promoted assumption's answer needs its own small re-refine before Ready (ADR-0075).
    const promotedGap = ticket.refineAssumptions.some((a) => a.questionId === question.id);
    // Only Up next goes to Ready on an answer: an Idea hasn't passed the gate. Any answered gap,
    // not just this one, still needs its re-refine first.
    const gapWaiting = promotedGap || ticket.refineAssumptions.some((a) => a.status === "answered");
    // A held gap waiting on a cap keeps the ticket in Needs-you (AI-75), unless a re-refine is
    // due: an answered gap, or the Definition of Ready misses more than the held gaps.
    const held =
      heldGaps(ticket).length > 0 &&
      !gapWaiting &&
      checkDor({ ...ticket, refineAssumptions: [] }, open).met;
    await this.tracker.updateTicket(
      ticket.projectId,
      ticket.id,
      {
        fields: {
          needsAttention: open > 0 || held,
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
    if (met && !gapWaiting && ticket.upNextRank !== null && ticket.stage === "backlog") {
      await this.promote(ticket);
    } else if (ticket.stage === "backlog") {
      // Refine waits for the last answer by itself; a freed slot may ask a held gap (AI-75).
      await this.dispatchNext?.(ticket.projectId);
    }
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
    const visible = questions.filter((q) => !hidden.has(q.ticketId));
    // A flag left on a finished ticket (AI-2) isn't waiting on anyone, unless a question is open
    // (the inbox lists those under Stale).
    const tickets = flagged
      .flat()
      .filter(
        (t) =>
          !hidden.has(t.id) && (t.stage !== "done" || questions.some((q) => q.ticketId === t.id)),
      );
    // Every reader gets the inbox's order (AI-40).
    const { active, stale } = inboxCards({ questions: visible, tickets });
    return { questions: [...active, ...stale].flatMap((c) => c.questions), tickets };
  }

  /** "AI-42" → the ticket. A project's id is its key lowercased (WorkTracker contract). */
  async findByKey(key: string): Promise<Ticket> {
    if (!TicketKey.safeParse(key).success) throw notFound("ticket", key);
    const projectId = key.slice(0, key.lastIndexOf("-")).toLowerCase();
    const ticket = await this.tracker.getTicketByKey(projectId, key);
    if (!ticket) throw notFound("ticket", key);
    return ticket;
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    return project;
  }

  async status(key: string): Promise<TicketStatus> {
    const ticket = await this.findByKey(key);
    const [questions, events] = await Promise.all([
      this.tracker.listQuestions({ ticketId: ticket.id }),
      this.tracker.listEvents(ticket.projectId, ticket.id),
    ]);
    const open = questions.filter((q) => q.status === "open").length;
    const project = await this.requireProject(ticket.projectId);
    return {
      ticket,
      readiness: checkDor(ticket, open),
      questions,
      recentEvents: events.slice(-RECENT_EVENTS),
      worker: resolveWorker(ticket, project, await this.epicFor(ticket)),
      executor: executorView(ticket, project, await this.runnerPresent(project.id)),
    };
  }

  async overview(): Promise<Overview> {
    const [projects, inbox] = await Promise.all([this.tracker.listProjects(), this.needsYou()]);
    const counted = await Promise.all(
      projects.map(async (p) => {
        const ticketsByStage = await this.tracker.countByStage(p.id);
        const { runsAtOnce, paused, lastDispatch } = p;
        return {
          key: p.key,
          name: p.name,
          ticketsByStage,
          dispatch: { runsAtOnce, paused, lastDispatch },
        };
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
