import type {
  DispatchDecision,
  DispatchIdleReason,
  PlanApproval,
  Project,
  QuotaLevel,
  QuotaStore,
  Run,
  Runner,
  RunStore,
  Ticket,
  WorkTracker,
} from "@andy/contracts";
import { MAX_BUILD_RUNS_PER_TICKET, isAndysWork, unfinishedBlockers } from "./builds";
import { mayDispatch, wasDispatched } from "./dispatch-caps";
import { blockingRun, editingRuns } from "./dispatch-conflicts";
import { checkDor } from "./dor";
import { MAX_PLAN_RUNS_PER_TICKET, planRequired } from "./plans";
import { quotaStatus, readingsForDispatch } from "./quota";
import { blockersDoneAt, replanNote, staleBlocker, writtenPlan } from "./replan";
import type { RunService } from "./runs";
import { isDispatchable } from "./worker";
import { ACTIONS_ROUTE, routeTakes, type DispatchRoute } from "./executor";
import { DomainError } from "./tickets";

/** What the dispatcher starts for a ticket; `replanFor` names the blocker that made its plan stale. */
type Start = { step: "build"; replanFor: null } | { step: "plan"; replanFor: string };
const BUILD: Start = { step: "build", replanFor: null };

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
 * has every `blockedBy` ticket Done and is under its build-run cap. A ticket whose `touches`
 * overlap a build run in flight in the project is skipped for the next one in rank order
 * (ADR-0080); with nothing else started, the decision is `touches_overlap`. With plan approval
 * (ADR-0050), a ticket whose plan awaits Andy, is still being planned or was rejected waits for
 * Andy (only he re-plans a rejected plan); one that needs a plan gets a plan run first.
 * A plan written before a `blockedBy` ticket reached Done is re-run before the build, whatever
 * the policy (M4.6: just-in-time re-planning); the new plan then waits for Andy like any other.
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
      return await this.dispatch(projectId, ACTIONS_ROUTE);
    } catch (err) {
      log("ERROR", "build dispatch failed", { projectId, error: String(err) });
      return null;
    }
  }

  /**
   * A local runner's claim (ADR-0089): the same selection and caps, limited to tickets that ask
   * for `local`, starting at most one run, claimed by `runner`. Never throws.
   */
  async claimFor(projectId: string, runner: Runner): Promise<Run | null> {
    try {
      return await this.dispatch(projectId, { kind: "local", runner });
    } catch (err) {
      log("ERROR", "build claim failed", { projectId, runnerId: runner.id, error: String(err) });
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

  private async dispatch(projectId: string, route: DispatchRoute): Promise<Run | null> {
    const local = route.kind === "local";
    if (!local && !this.runs.canDispatch) return null;
    const project = await this.tracker.getProject(projectId);
    if (!project?.autoBuild || !project.buildEnabled) return null;
    // The claiming runner is present by definition; the cloud dispatcher asks (ADR-0089).
    const runnerPresent = local || (await this.runs.runnerPresent(projectId));
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
    let overlapSkipped = false;
    // Build runs in flight here, kept current as this call starts more (ADR-0080).
    const inFlight = editingRuns(await this.runStore.listActive(projectId), this.now());
    let verdict = await check();
    // listTickets is sorted by rank: the first waiting ticket is the top of the order.
    for (const ticket of tickets.filter((t) => t.stage === "ready")) {
      if (verdict !== "start") break;
      // An epic never runs (ADR-0058); refine can leave one in Ready. Andy's own work never builds.
      if (ticket.type === "epic" || isAndysWork(ticket)) continue;
      if (!isDispatchable(ticket, project)) continue; // AI-32: Who does the work (ADR-0082).
      if (!routeTakes(route, ticket, project, runnerPresent)) continue; // ADR-0089.
      if (ticket.archived || ticket.needsAttention) continue;
      const blocker = blockingRun(ticket, inFlight);
      if (blocker) {
        overlapSkipped = true;
        log("INFO", "build waits: touches overlap a run in flight", {
          ticket: ticket.key,
          reason: "touches_overlap",
          blockingTicket: tickets.find((t) => t.id === blocker.ticketId)?.key ?? null,
          blockingRunId: blocker.id,
        });
        continue;
      }
      const start = await this.waiting(ticket, project.planApproval);
      if (!start) continue;
      try {
        const run = await this.runs.start(projectId, ticket.id, start.step, undefined, {
          avoidOverlap: true,
          ...(local ? { runner: route.runner } : {}),
        });
        log("INFO", "build started on its own", {
          ticket: ticket.key,
          runId: run.id,
          step: run.step,
          local,
          ...(start.replanFor ? { reason: "plan_stale", blocker: start.replanFor } : {}),
        });
        if (start.replanFor) await this.noteReplan(ticket, start.replanFor);
        // A claim hands the runner one run; it claims again when it has a free slot.
        if (local) return run;
        first ??= run;
        inFlight.push(...editingRuns([run], this.now()));
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
    // A claim every 30 s must not rewrite the project's last decision (the cloud's) each time.
    if (local) return null;
    const decision =
      verdict !== "start"
        ? verdict
        : first
          ? "started"
          : overlapSkipped
            ? "touches_overlap"
            : "nothing_ready";
    await this.record(project, decision, first !== null);
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

  /** What to start for a waiting ticket, or null when it doesn't wait. */
  private async waiting(ticket: Ticket, policy: PlanApproval): Promise<Start | null> {
    const open = await this.tracker.listQuestions({ ticketId: ticket.id, status: "open" });
    if (!checkDor(ticket, open.length).met) return null;
    if (unfinishedBlockers(ticket, await this.runs.blockerStages(ticket)).length > 0) return null;
    const builds = (await this.runStore.listForTicket(ticket.projectId, ticket.id)).filter(
      (r) => r.step === "build" && wasDispatched(r),
    );
    if (builds.length >= MAX_BUILD_RUNS_PER_TICKET) {
      await this.flag(
        ticket,
        `Build ran ${builds.length} times without a merged change. Finish the ticket by hand.`,
      );
      return null;
    }
    return this.planAllows(ticket, policy);
  }

  /**
   * What the ticket's plan lets start now: a build (`RunService.start` turns it into a plan run
   * when the policy needs one), a plan re-run for a plan older than a blocker's Done, or nothing.
   */
  private async planAllows(ticket: Ticket, policy: PlanApproval): Promise<Start | null> {
    const plan = await this.runs.planStateOf(ticket, undefined, policy);
    let stale: string | null = null;
    if (ticket.blockedBy.length > 0 && writtenPlan(plan)) {
      try {
        stale = staleBlocker(plan, await blockersDoneAt(this.tracker, ticket));
      } catch (err) {
        // Freshness unknown: skip the ticket this time rather than build on a stale plan.
        log("WARNING", "build waits: blocker Done times unreadable", {
          ticket: ticket.key,
          error: String(err),
        });
        return null;
      }
    }
    if (stale) return (await this.underPlanCap(ticket)) ? { step: "plan", replanFor: stale } : null;
    if (plan.kind === "approved") return BUILD;
    if (plan.kind === "awaiting" || plan.kind === "planning") return null;
    if (!planRequired(policy, ticket)) return BUILD;
    if (plan.kind === "rejected") return null;
    return (await this.underPlanCap(ticket)) ? BUILD : null;
  }

  /** The timeline line for a re-plan; best-effort, as the plan run has already started. */
  private async noteReplan(ticket: Ticket, blocker: string): Promise<void> {
    try {
      await this.tracker.addComment(ticket.projectId, ticket.id, replanNote(blocker), "system");
    } catch (err) {
      log("WARNING", "re-plan note not written", { ticket: ticket.key, error: String(err) });
    }
  }

  /** Under MAX_PLAN_RUNS_PER_TICKET; a ticket at the cap is flagged. */
  private async underPlanCap(ticket: Ticket): Promise<boolean> {
    const plans = (await this.runStore.listForTicket(ticket.projectId, ticket.id)).filter(
      (r) => r.step === "plan" && wasDispatched(r),
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
