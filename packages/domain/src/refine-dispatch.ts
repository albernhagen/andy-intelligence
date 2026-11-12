import {
  compareRanks,
  type Run,
  type Runner,
  type RunStore,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { wasDispatched } from "./dispatch-caps";
import { checkDor } from "./dor";
import { MAX_REFINE_RUNS_PER_TICKET, type RunService } from "./runs";
import { DomainError } from "./tickets";
import { ACTIONS_ROUTE, routeTakes, type DispatchRoute } from "./executor";

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
 * Needs-you, and any of: it entered Up next since its last refine; Andy answered a
 * promoted assumption; or its last refine succeeded and the Definition of Ready is still unmet
 * after his answers. A failed refine is never retried here: it flags Needs-you and Andy decides.
 *
 * `askHeld` asks held gaps (AI-75, ADR-0087) as far as the question caps allow; the API calls it
 * on every dispatch event. There is no timer, so a gap held by the daily cap is asked at the
 * first dispatch event after the window. Asking costs no run, so it doesn't wait for auto-refine,
 * a free run slot or the executor; a paused project asks nothing.
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
      return await this.dispatch(projectId, ACTIONS_ROUTE);
    } catch (err) {
      log("ERROR", "refine dispatch failed", { projectId, error: String(err) });
      return null;
    }
  }

  /**
   * A local runner's claim (ADR-0089): the same selection, limited to tickets that ask for
   * `local`, claimed by `runner`. Never throws.
   */
  async claimFor(projectId: string, runner: Runner): Promise<Run | null> {
    try {
      return await this.dispatch(projectId, { kind: "local", runner });
    } catch (err) {
      log("ERROR", "refine claim failed", { projectId, runnerId: runner.id, error: String(err) });
      return null;
    }
  }

  private async dispatch(projectId: string, route: DispatchRoute): Promise<Run | null> {
    const local = route.kind === "local";
    if (!local && !this.runs.canDispatch) return null;
    const project = await this.tracker.getProject(projectId);
    if (!project?.autoRefine || project.paused) return null;
    if (await this.busy(projectId)) return null;
    const runnerPresent = local || (await this.runs.runnerPresent(projectId));

    for (const ticket of await this.upNext(projectId)) {
      // Backlog only, so Done and cancelled tickets never qualify; nor do hidden ones. Epics do
      // (AI-115): their refine splits them into stories.
      if (ticket.archived || ticket.needsAttention) continue;
      if (!routeTakes(route, ticket, project, runnerPresent)) continue; // ADR-0089.
      if (!(await this.waiting(ticket))) continue;
      try {
        const run = await this.runs.start(
          projectId,
          ticket.id,
          "refine",
          undefined,
          local ? { runner: route.runner } : {},
        );
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

  /**
   * Asks held gaps in Up-next order, each ticket against the caps as they stand after the last;
   * returns how many it asked. Never throws.
   */
  async askHeld(projectId: string): Promise<number> {
    // One at a time per project in this instance, so two events can't both spend the same
    // daily slots on different tickets. Across instances a small overshoot remains (ADR-0087).
    const prev = this.heldQueue.get(projectId) ?? Promise.resolve(0);
    const next = prev.then(() => this.askHeldNow(projectId));
    this.heldQueue.set(projectId, next);
    try {
      return await next;
    } finally {
      if (this.heldQueue.get(projectId) === next) this.heldQueue.delete(projectId);
    }
  }

  private readonly heldQueue = new Map<string, Promise<number>>();

  private async askHeldNow(projectId: string): Promise<number> {
    try {
      const project = await this.tracker.getProject(projectId);
      if (!project || project.paused) return 0;
      return await this.askHeldIn(projectId);
    } catch (err) {
      log("ERROR", "held gaps not asked", { projectId, error: String(err) });
      return 0;
    }
  }

  private async askHeldIn(projectId: string): Promise<number> {
    const gate = this.runs.refineGate();
    let asked = 0;
    for (const ticket of await this.upNext(projectId)) {
      if (ticket.archived) continue;
      try {
        asked += await gate.askHeld(ticket);
      } catch (err) {
        // A conflict means the ticket changed meanwhile; the next dispatch event tries again.
        log("WARNING", "held gaps not asked", { ticket: ticket.key, error: String(err) });
      }
    }
    return asked;
  }

  private async upNext(projectId: string): Promise<Ticket[]> {
    return (await this.tracker.listTickets(projectId, { stage: "backlog" }))
      .filter((t) => t.upNextRank !== null)
      .sort((a, b) => compareRanks(a.upNextRank!, b.upNextRank!));
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
    const counted = refines.filter(wasDispatched).length;
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
