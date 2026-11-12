import {
  RUNNER_LIMITS,
  type ClaimedRun,
  type Runner,
  type RunStore,
  type WatchdogQueue,
  type WorkTracker,
} from "@andy/contracts";
import type { BuildDispatcher } from "./build-dispatch";
import { isInFlight } from "./dispatch-caps";
import type { RefineDispatcher } from "./refine-dispatch";
import type { RunnerService } from "./runners";
import type { RunService } from "./runs";

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "local-claims", ...fields }));
}

/** Seconds past the presence window before the runner-away check, so a claim on time wins. */
const AWAY_CHECK_GRACE_SECONDS = 5;

/**
 * A local runner's claim (ADR-0089 slice 4). No run exists until a present runner asks: the
 * claim runs the dispatchers' own selection (builds, then refines; sync runs stay on Actions
 * until slice 6), limited to tickets that ask for `local` in the runner's projects, and starts
 * the run through `RunService.start`, whose re-checks stop a ticket running twice. At most the
 * runner's `runsAtOnce` runs at a time, still under each project's dial and the global cap.
 */
export class LocalClaims {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly runStore: RunStore,
    private readonly runs: RunService,
    private readonly runners: RunnerService,
    private readonly builder: BuildDispatcher,
    private readonly refiner: RefineDispatcher,
    /** Null when no queue is configured (local dev): no runner-away wake-ups. */
    private readonly watchdog: WatchdogQueue | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The runner's next run with its per-run token, or null when there is nothing for it. */
  async claim(runner: Runner): Promise<ClaimedRun | null> {
    await this.scheduleAwayCheck(runner);
    if ((await this.activeOn(runner)) >= runner.runsAtOnce) return null;
    for (const projectId of runner.projectIds) {
      const run =
        (await this.builder.claimFor(projectId, runner)) ??
        (await this.refiner.claimFor(projectId, runner));
      if (!run) continue;
      const project = await this.tracker.getProject(projectId);
      const ticket = run.ticketId ? await this.tracker.getTicket(projectId, run.ticketId) : null;
      let token: string;
      try {
        token = await this.runners.issueRunToken(run.id, runner.id, run.deadline!);
      } catch (err) {
        await this.runs.abandonClaim(run, String(err));
        throw err;
      }
      log("INFO", "local run claimed", { runId: run.id, runnerId: runner.id, step: run.step });
      return {
        runId: run.id,
        token,
        step: run.step,
        ticketKey: ticket?.key ?? null,
        repo: project?.repos[0] ?? "",
        deadline: run.deadline!,
        leaseExpiresAt: run.localRun!.leaseExpiresAt,
      };
    }
    return null;
  }

  /** The runner's runs in flight across the projects it serves. */
  private async activeOn(runner: Runner): Promise<number> {
    const now = this.now();
    const active = await Promise.all(runner.projectIds.map((p) => this.runStore.listActive(p)));
    return active.flat().filter((r) => r.localRun?.runnerId === runner.id && isInFlight(r, now))
      .length;
  }

  /** Queues the runner-away check for when this claim's presence runs out; logs on failure. */
  private async scheduleAwayCheck(runner: Runner): Promise<void> {
    if (!this.watchdog) return;
    const at = new Date(
      this.now().getTime() + (RUNNER_LIMITS.presentSeconds + AWAY_CHECK_GRACE_SECONDS) * 1000,
    ).toISOString();
    try {
      await this.watchdog.scheduleCheck({ kind: "runner_away", runnerId: runner.id, at });
    } catch (err) {
      log("ERROR", "runner-away check not queued", { runnerId: runner.id, error: String(err) });
    }
  }
}
