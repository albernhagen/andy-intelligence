import type { Run, RunStore, Ticket, WorkTracker } from "@andy/contracts";
import { checkDor } from "./dor";
import { MAX_REFINE_RUNS_PER_TICKET, type RunService } from "./runs";
import { DomainError } from "./tickets";

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "refine-dispatch", ...fields }));
}

/**
 * Starts refine without Andy (ARCHITECTURE §4.3, ADR-0054). Event-driven, no polling: called
 * when a ticket is created, when a ticket's last open question is answered, and when a run ends.
 * Each call starts at most one run, for the oldest waiting Backlog ticket of the project; the
 * project's one-run-in-flight cap (ADR-0028) queues the rest until the next run ends.
 *
 * A ticket is waiting when it has no open questions, isn't flagged Needs-you, and either was
 * never refined or its last refine succeeded, every question it asked is answered, and the
 * Definition of Ready is still unmet. A failed refine is never retried here: it flags Needs-you
 * and Andy decides.
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

    for (const ticket of await this.tracker.listTickets(projectId, { stage: "backlog" })) {
      // Backlog only, so cancelled tickets never qualify; archived ones are hidden, skip them too.
      if (ticket.archived || ticket.needsYou || !(await this.waiting(ticket))) continue;
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
    const latest = refines[0];
    if (!latest) return true;
    if (latest.status !== "succeeded") return false;
    const dor = checkDor(ticket, 0);
    if (dor.met) return false;
    const counted = refines.filter((r) => r.executor !== null).length;
    if (counted >= MAX_REFINE_RUNS_PER_TICKET) {
      await this.flag(
        ticket,
        `Refine ran ${counted} times and the Definition of Ready still misses: ${dor.missing.join(", ")}. Finish the ticket by hand.`,
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
      { fields: { needsYou: true } },
      "system",
    );
  }
}
