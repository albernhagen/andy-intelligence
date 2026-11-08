import {
  compareRanks,
  type Run,
  type RunStore,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { checkDor } from "./dor";
import { MAX_REFINE_RUNS_PER_TICKET, type RunService } from "./runs";
import { DomainError } from "./tickets";

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "refine-dispatch", ...fields }));
}

/**
 * Starts refine without Andy (ARCHITECTURE §4.3, ADR-0054, ADR-0075). Event-driven, no polling:
 * called when a ticket enters Up next, when a ticket's last open question is answered, and when a
 * run ends. Each call starts at most one run, for the first waiting ticket in Up next; the
 * project's one-run-in-flight cap (ADR-0028) queues the rest until the next run ends.
 *
 * Ideas are never refined. An Up-next ticket waits when it has no open questions, isn't flagged
 * Needs-you, isn't an epic, and any of: it entered Up next since its last refine; Andy answered a
 * promoted assumption; or its last refine succeeded and the Definition of Ready is still unmet
 * after his answers. A failed refine is never retried here: it flags Needs-you and Andy decides.
 */
export class RefineDispatcher {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly runStore: RunStore,
    private readonly runs: RunService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Starts the next waiting refine in the project; null when nothing started. Never throws. */
  async next(projectId: string): Promise<Run | null> {
    try {
      return await this.dispatch(projectId);
    } catch (err) {
      log("ERROR", "refine dispatch failed", { projectId, error: String(err) });
      return null;
    }
  }

  private async dispatch(projectId: string): Promise<Run | null> {
    if (!this.runs.canDispatch) return null;
    const project = await this.tracker.getProject(projectId);
    if (!project?.autoRefine) return null;
    if (await this.busy(projectId)) return null;

    const upNext = (await this.tracker.listTickets(projectId, { stage: "backlog" }))
      .filter((t) => t.upNextRank !== null)
      .sort((a, b) => compareRanks(a.upNextRank!, b.upNextRank!));
    for (const ticket of upNext) {
      // Backlog only, so Done and cancelled tickets never qualify; nor do hidden ones or epics.
      if (ticket.archived || ticket.type === "epic" || ticket.needsAttention) continue;
      if (!(await this.waiting(ticket))) continue;
      try {
        const run = await this.runs.start(projectId, ticket.id, "refine");
        log("INFO", "refine started on its own", { ticket: ticket.key, runId: run.id });
        return run;
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        // run_limit: another start won the race. not_refinable: the ticket changed meanwhile.
        log("WARNING", "refine not started", { ticket: ticket.key, reason: err.message });
        if (err.code === "dispatch_failed") {
          await this.flag(
            ticket,
            `Refine couldn't start: ${err.message}. Start it again from the ticket.`,
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
    if (open.length > 0) return false;
    const refines = (await this.runStore.listForTicket(ticket.projectId, ticket.id)).filter(
      (r) => r.step === "refine",
    );
    const entered = ticket.upNextAt;
    const newEntry = entered !== null && !refines.some((r) => (r.createdAt ?? "") >= entered);
    const gapAnswered = ticket.refineAssumptions.some((a) => a.status === "answered");
    const latest = refines[0];
    const dor = checkDor(ticket, 0);
    if (!newEntry && !gapAnswered) {
      if (!latest || latest.status !== "succeeded" || dor.met) return false;
    }
    const counted = refines.filter((r) => r.executor !== null).length;
    if (counted >= MAX_REFINE_RUNS_PER_TICKET) {
      const still = dor.met
        ? ""
        : ` and the Definition of Ready still misses: ${dor.missing.join(", ")}`;
      await this.flag(ticket, `Refine ran ${counted} times${still}. Finish the ticket by hand.`);
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
