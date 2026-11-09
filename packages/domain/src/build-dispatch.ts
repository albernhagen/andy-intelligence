import type {
  DispatchDecision,
  DispatchIdleReason,
  PlanApproval,
  Project,
  QuotaLevel,
  QuotaStore,
  Run,
  RunStore,
  Ticket,
  WorkTracker,
} from "@andy/contracts";
import { MAX_BUILD_RUNS_PER_TICKET, isAndysWork, unfinishedBlockers } from "./builds";
import { mayDispatch } from "./dispatch-caps";
import { checkDor } from "./dor";
import { MAX_PLAN_RUNS_PER_TICKET, planRequired } from "./plans";
import { quotaStatus, readingsForDispatch } from "./quota";
import type { RunService } from "./runs";
import { DomainError } from "./tickets";

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "build-dispatch", ...fields }));
}

/**
 * Starts build runs without Andy (ARCHITECTURE §4.1 Ready, ADR-0063), only in projects with
 * `autoBuild` on (default off). Event-driven, no polling: called when a ticket reaches Ready,
 * when a run ends (report or watchdog), when a cancel frees the run slot, and when `autoBuild`
 * or the dial is changed. Each call takes waiting Ready tickets by rank (order is priority,
 * ADR-0058) while `mayDispatch` says start, and stores its last decision on the project (ADR-0079).
 *
 * A Ready ticket waits when it isn't an epic, assigned to Andy (`overrides.assignee: "me"`), archived or flagged Needs-you, meets the Definition of Ready,
 * has every `blockedBy` ticket Done and is under its build-run cap. With plan approval
 * (ADR-0050), a ticket whose plan awaits Andy, is still being planned or was rejected waits for
 * Andy (only he re-plans a rejected plan); one that needs a plan gets a plan run first.
 */
export class BuildDispatcher {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly runStore: RunStore,
    private readonly runs: RunService,
    private readonly now: () => Date = () => new Date(),
    /** Null when no readings are kept: quota then reads unknown, which doesn't stop dispatch. */
    private readonly quota: QuotaStore | null = null,
  ) {}

  /** Starts waiting builds in the project up to the caps; the first run, or null. Never throws. */
  async next(projectId: string): Promise<Run | null> {
    try {
      return await this.dispatch(projectId);
    } catch (err) {
      log("ERROR", "build dispatch failed", { projectId, error: String(err) });
      return null;
    }
  }

  /**
   * Gives projects idle on the global cap a turn, longest wait first, before the project that
   * freed a slot can refill it (ADR-0079). Never throws.
   */
  async wakeGlobalCapWaiters(exceptProjectId: string): Promise<void> {
    try {
      const waiting = (await this.tracker.listProjects())
        .filter((p) => p.id !== exceptProjectId && p.lastDispatch?.decision === "global_cap")
        .sort((a, b) => a.lastDispatch!.at.localeCompare(b.lastDispatch!.at));
      for (const p of waiting) await this.next(p.id);
    } catch (err) {
      log("ERROR", "waking projects at the global cap failed", { error: String(err) });
    }
  }

  private async dispatch(projectId: string): Promise<Run | null> {
    if (!this.runs.canDispatch) return null;
    const project = await this.tracker.getProject(projectId);
    if (!project?.autoBuild || !project.buildEnabled) return null;
    const tickets = await this.tracker.listTickets(projectId, { archived: false });
    const prsWaiting = await this.prsWaiting(tickets);
    const quotaLevel = await this.quotaLevel();
    const check = async (): Promise<"start" | DispatchIdleReason> => {
      const active = await this.runs.activeCounts(projectId);
      return mayDispatch(project, {
        projectActive: active.project,
        globalActive: active.global,
        prsWaiting,
        quotaLevel,
      });
    };

    let first: Run | null = null;
    let verdict = await check();
    // listTickets is sorted by rank: the first waiting ticket is the top of the order.
    for (const ticket of tickets.filter((t) => t.stage === "ready")) {
      if (verdict !== "start") break;
      // An epic never runs (ADR-0058); refine can leave one in Ready. Andy's own work never builds.
      if (ticket.type === "epic" || isAndysWork(ticket)) continue;
      if (ticket.archived || ticket.needsAttention) continue;
      if (!(await this.waiting(ticket, project.planApproval))) continue;
      try {
        const run = await this.runs.start(projectId, ticket.id, "build");
        log("INFO", "build started on its own", { ticket: ticket.key, runId: run.id });
        first ??= run;
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        // run_limit: another start won the race. not_buildable: the ticket changed meanwhile.
        log("WARNING", "build not started", { ticket: ticket.key, reason: err.message });
        if (err.code === "dispatch_failed") {
          await this.flag(
            ticket,
            `Build couldn't start: ${err.message}. Start it again from the ticket.`,
          );
        }
        return first;
      }
      verdict = await check();
    }
    await this.record(
      project,
      verdict === "start" ? (first ? "started" : "nothing_ready") : verdict,
      first !== null,
    );
    return first;
  }

  /**
   * Stores the decision when it changed or a run started: `at` says since when, repeats cost no
   * write, and a project that just took a slot goes behind the others waiting for one.
   */
  private async record(
    project: Project,
    decision: DispatchDecision,
    startedRun: boolean,
  ): Promise<void> {
    if (decision !== "started" && decision !== "nothing_ready") {
      log("INFO", "build dispatch idle", { projectId: project.id, reason: decision });
    }
    if (project.lastDispatch?.decision === decision && !startedRun) return;
    await this.tracker.updateProject(project.id, {
      lastDispatch: { decision, at: this.now().toISOString() },
    });
  }

  /** Tickets in Ready for review (an open PR, by the stage rules) whose PR a build run opened. */
  private async prsWaiting(tickets: Ticket[]): Promise<number> {
    const waiting = await Promise.all(
      tickets
        .filter((t) => t.stage === "ready_for_review")
        .map(async (t) =>
          (await this.runStore.listForTicket(t.projectId, t.id)).some(
            (r) => r.step === "build" && r.links.pullRequest,
          ),
        ),
    );
    return waiting.filter(Boolean).length;
  }

  private async quotaLevel(): Promise<QuotaLevel> {
    if (!this.quota) return "unknown";
    const now = this.now();
    const readings = readingsForDispatch(await this.quota.latest("claude-sub"), now);
    return quotaStatus("claude-sub", readings, now).level;
  }

  private async waiting(ticket: Ticket, policy: PlanApproval): Promise<boolean> {
    const open = await this.tracker.listQuestions({ ticketId: ticket.id, status: "open" });
    if (!checkDor(ticket, open.length).met) return false;
    if (unfinishedBlockers(ticket, await this.runs.blockerStages(ticket)).length > 0) return false;
    const builds = (await this.runStore.listForTicket(ticket.projectId, ticket.id)).filter(
      (r) => r.step === "build" && r.executor !== null,
    );
    if (builds.length >= MAX_BUILD_RUNS_PER_TICKET) {
      await this.flag(
        ticket,
        `Build ran ${builds.length} times without a merged change. Finish the ticket by hand.`,
      );
      return false;
    }
    return this.planAllows(ticket, policy);
  }

  /** Whether the ticket's plan lets a start go ahead now (a build, or a plan run first). */
  private async planAllows(ticket: Ticket, policy: PlanApproval): Promise<boolean> {
    const plan = await this.runs.planStateOf(ticket, undefined, policy);
    if (plan.kind === "approved") return true;
    if (plan.kind === "awaiting" || plan.kind === "planning") return false;
    if (!planRequired(policy, ticket)) return true;
    if (plan.kind === "rejected") return false;
    const plans = (await this.runStore.listForTicket(ticket.projectId, ticket.id)).filter(
      (r) => r.step === "plan" && r.executor !== null,
    );
    if (plans.length >= MAX_PLAN_RUNS_PER_TICKET) {
      await this.flag(
        ticket,
        `Plan ran ${plans.length} times without an approved plan. Finish the ticket by hand or set the project's plan approval to none.`,
      );
      return false;
    }
    return true;
  }

  /** Puts the ticket in Needs-you with the reason as a comment; the flag keeps it skipped. */
  private async flag(ticket: Ticket, reason: string): Promise<void> {
    await this.tracker.addComment(ticket.projectId, ticket.id, reason, "system");
    await this.tracker.updateTicket(
      ticket.projectId,
      ticket.id,
      { fields: { needsAttention: true } },
      "system",
    );
  }
}
