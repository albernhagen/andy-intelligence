import type { Run, RunStore, Ticket, WorkTracker } from "@andy/contracts";
import {
  MAX_BUILD_RUNS_PER_TICKET,
  MAX_TICKETS_IN_FLIGHT,
  isAndysWork,
  unfinishedBlockers,
} from "./builds";
import { checkDor } from "./dor";
import type { RunService } from "./runs";
import { DomainError } from "./tickets";

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "build-dispatch", ...fields }));
}

/**
 * Starts build runs without Andy (ARCHITECTURE §4.1 Ready, ADR-0063), only in projects with
 * `autoBuild` on (default off). Event-driven, no polling: called when a ticket reaches Ready,
 * when a run ends (report or watchdog), when a cancel frees the run slot, and when `autoBuild`
 * is turned on. Each call starts at most one run: the first waiting Ready ticket by rank (order
 * is priority, ADR-0058).
 *
 * A Ready ticket waits when it isn't an epic, assigned to Andy (`overrides.assignee: "me"`), archived or flagged Needs-you, meets the Definition of Ready,
 * has every `blockedBy` ticket Done and is under its build-run cap. The project's
 * one-run-in-flight cap (ADR-0028) queues the rest; MAX_TICKETS_IN_FLIGHT stops dispatch while
 * too many built tickets wait for review.
 */
export class BuildDispatcher {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly runStore: RunStore,
    private readonly runs: RunService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Starts the next waiting build in the project; null when nothing started. Never throws. */
  async next(projectId: string): Promise<Run | null> {
    try {
      return await this.dispatch(projectId);
    } catch (err) {
      log("ERROR", "build dispatch failed", { projectId, error: String(err) });
      return null;
    }
  }

  private async dispatch(projectId: string): Promise<Run | null> {
    if (!this.runs.canDispatch) return null;
    const project = await this.tracker.getProject(projectId);
    if (!project?.autoBuild || !project.buildEnabled) return null;
    if (await this.busy(projectId)) return null;
    const tickets = await this.tracker.listTickets(projectId, { archived: false });
    const inFlight = tickets.filter(
      (t) => t.stage === "in_progress" || t.stage === "ready_for_review",
    ).length;
    if (inFlight >= MAX_TICKETS_IN_FLIGHT) {
      log("INFO", "build dispatch paused: tickets waiting for review", { projectId, inFlight });
      return null;
    }

    // listTickets is sorted by rank: the first waiting ticket is the top of the order.
    for (const ticket of tickets.filter((t) => t.stage === "ready")) {
      // An epic never runs (ADR-0058); refine can leave one in Ready. Andy's own work never builds.
      if (ticket.type === "epic" || isAndysWork(ticket)) continue;
      if (ticket.archived || ticket.needsAttention) continue;
      if (!(await this.waiting(ticket))) continue;
      try {
        const run = await this.runs.start(projectId, ticket.id, "build");
        log("INFO", "build started on its own", { ticket: ticket.key, runId: run.id });
        return run;
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
        return null;
      }
    }
    return null;
  }

  /** A run in flight that is still within its deadline (as RunService counts them). */
  private async busy(projectId: string): Promise<boolean> {
    const nowMs = this.now().getTime();
    return (await this.runStore.listActive(projectId)).some(
      (r) => !r.deadline || Date.parse(r.deadline) > nowMs,
    );
  }

  private async waiting(ticket: Ticket): Promise<boolean> {
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
