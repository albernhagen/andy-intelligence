import {
  ACTIVE_RUN_STATUSES,
  DEFAULT_SPEND_CAPS,
  type ProjectSpendCaps,
  type Route,
  type Run,
  type RunUsage,
  type SpendCapKey,
  type SpendCaps,
  type SpendEntry,
  type SpendLedger,
  type SpendSoFar,
} from "@andy/contracts";
import { DomainError } from "./errors";
import { effectiveCaps, maySpend } from "./spend-caps";
import { reserveFor, settleFor, type PricedModel } from "./spend-estimate";
import type { SpendEvent } from "./spend-notices";

/**
 * Spend gate (AI-248: M10.7). Every agent task on a `pay_per_use` route reserves
 * its worst case in the spend ledger before it starts, and settles or releases it when it ends.
 * Subscription routes never come here. It fails closed: no price, unreadable caps or totals, a
 * cap that would be passed, or a ledger error means the task doesn't start (`spend_cap`). A
 * reservation is never dropped silently: it is released (the task never got its instructions,
 * so it never called a model), settled, or kept in full.
 */

/** The model's prices for a route; null when unknown (then no paid task starts). */
export type SpendPrices = (route: Route) => Promise<PricedModel | null>;

/** The global caps and the project's own; M10.8 stores them, until then the defaults. */
export type SpendCapsSource = (
  projectId: string,
) => Promise<{ global: SpendCaps; project: ProjectSpendCaps | null }>;

export const DEFAULT_CAPS_SOURCE: SpendCapsSource = async () => ({
  global: DEFAULT_SPEND_CAPS,
  project: null,
});

/** No price source yet (M10.5 scouts prices): every paid start is refused. */
export const NO_PRICES: SpendPrices = async () => null;

/** Hears what the gate decided, for the spend notices (AI-257: M10.9); must not throw. */
export type SpendAlertSink = (event: SpendEvent) => Promise<void>;

/** The run fields `reserve` reads; `ticketId` names what waits in a stop notice. */
type GateRun = Pick<Run, "id" | "projectId" | "route"> & Partial<Pick<Run, "ticketId">>;

const stopOf = (stop: {
  cap: SpendCapKey;
  caps: ReturnType<typeof effectiveCaps>;
  totals: SpendSoFar;
}) => ({ cap: stop.cap, caps: stop.caps, spent: stop.totals });

const alertRun = (run: GateRun) => ({
  id: run.id,
  projectId: run.projectId,
  ticketId: run.ticketId ?? null,
});

/** What a reservation hands the executor: the per-task budget the harness enforces. */
export interface SpendReservation {
  entry: SpendEntry;
  budgetMicroUsd: number;
}

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "spend-gate", ...fields }));
}

const refuse = (run: Pick<Run, "id" | "projectId">, reason: string, details: string[] = []) => {
  log("WARNING", "paid agent task refused", { runId: run.id, projectId: run.projectId, reason });
  return new DomainError("spend_cap", `no paid agent task: ${reason}`, details);
};

export class SpendGate {
  constructor(
    private readonly ledger: SpendLedger,
    private readonly prices: SpendPrices = NO_PRICES,
    private readonly caps: SpendCapsSource = DEFAULT_CAPS_SOURCE,
    private readonly now: () => Date = () => new Date(),
    private readonly alerts: SpendAlertSink | null = null,
  ) {}

  /**
   * Whether a task on `route` in the project would be allowed now, without reserving: null, or
   * why not. Route fallback (AI-261: M10.14) asks this to skip a paid route instead of starting
   * it; `reserve` still decides, so a race between the two is refused there.
   */
  async refusal(projectId: string, route: Route): Promise<string | null> {
    const checked = await this.check({ id: null, projectId, route });
    return checked.ok ? null : `no paid agent task: ${checked.reason}`;
  }

  /** The caps and worst case for a task, or why it can't start. Reads; writes nothing. */
  private async check(run: { id: string | null; projectId: string; route: Route }): Promise<
    | {
        ok: true;
        caps: ReturnType<typeof effectiveCaps>;
        estimate: number;
        at: string;
        totals: SpendSoFar;
      }
    | {
        ok: false;
        reason: string;
        details?: string[];
        /** Set when a cap stops it: what a stop notice needs (AI-257). */
        stop?: { cap: SpendCapKey; caps: ReturnType<typeof effectiveCaps>; totals: SpendSoFar };
      }
  > {
    const model = await this.prices(run.route).catch((err: unknown) => {
      log("ERROR", "model prices unreadable", { runId: run.id, error: String(err) });
      return null;
    });
    if (!model)
      return { ok: false, reason: `no price for ${run.route.provider}/${run.route.model}` };
    let caps;
    try {
      const source = await this.caps(run.projectId);
      caps = effectiveCaps(source.global, source.project);
    } catch (err) {
      log("ERROR", "spend caps unreadable", { runId: run.id, error: String(err) });
      return { ok: false, reason: "the spend caps can't be read" };
    }
    const estimate = reserveFor(model, { kind: "task", taskCapMicroUsd: caps.per_task });
    if (estimate === null) return { ok: false, reason: "no estimate for its model" };
    const at = this.now().toISOString();
    let totals;
    try {
      const [project, global] = await Promise.all([
        this.ledger.totals({ projectId: run.projectId }, at),
        this.ledger.totals({}, at),
      ]);
      totals = { project, global };
    } catch (err) {
      log("ERROR", "spend totals unreadable", { runId: run.id, error: String(err) });
      return { ok: false, reason: "the spend ledger can't be read" };
    }
    const decision = maySpend(caps, totals, estimate);
    if (decision.kind === "unknown") return { ok: false, reason: `unknown ${decision.reason}` };
    if (decision.kind === "cap") {
      return {
        ok: false,
        reason: `it would pass the ${decision.cap} cap`,
        details: [
          `limit: ${decision.limitMicroUsd} micro-USD`,
          `used: ${decision.usedMicroUsd} micro-USD`,
        ],
        stop: { cap: decision.cap, caps, totals },
      };
    }
    return { ok: true, caps, estimate, at, totals };
  }

  /**
   * Reserves the run's worst case: an agentic task's per-task cap (its turns and tokens aren't
   * known up front). Throws `DomainError` `spend_cap` when anything is unknown or a cap would be
   * passed; nothing is left reserved then.
   */
  async reserve(run: GateRun): Promise<SpendReservation> {
    const checked = await this.check(run);
    if (!checked.ok) {
      if (checked.stop)
        await this.alert({ kind: "stopped", run: alertRun(run), ...stopOf(checked.stop) });
      throw refuse(run, checked.reason, checked.details);
    }
    const { caps, estimate, at, totals } = checked;
    const entry: SpendEntry = {
      id: run.id,
      runId: run.id,
      projectId: run.projectId,
      provider: run.route.provider,
      model: run.route.model,
      state: "reserved",
      reservedMicroUsd: estimate,
      settledMicroUsd: null,
      at,
      settledAt: null,
    };
    let outcome;
    try {
      outcome = await this.ledger.reserve(entry, caps);
    } catch (err) {
      // The write may or may not have landed: release it (idempotent; nothing if it didn't).
      log("ERROR", "spend reserve failed", { runId: run.id, error: String(err) });
      await this.release(run.id);
      throw refuse(run, "the spend ledger refused the reservation");
    }
    if (!outcome.ok) {
      await this.alert({
        kind: "stopped",
        run: alertRun(run),
        cap: outcome.cap,
        caps,
        spent: totals,
      });
      throw refuse(run, `it would pass the ${outcome.cap} cap`, [
        `limit: ${outcome.limitMicroUsd} micro-USD`,
        `used: ${outcome.usedMicroUsd} micro-USD`,
      ]);
    }
    log("INFO", "spend reserved", { runId: run.id, microUsd: outcome.entry.reservedMicroUsd });
    const added = outcome.entry.reservedMicroUsd;
    await this.alert({
      kind: "reserved",
      run: alertRun(run),
      caps,
      spent: {
        project: {
          dayMicroUsd: totals.project.dayMicroUsd + added,
          monthMicroUsd: totals.project.monthMicroUsd + added,
        },
        global: {
          dayMicroUsd: totals.global.dayMicroUsd + added,
          monthMicroUsd: totals.global.monthMicroUsd + added,
        },
      },
    });
    return { entry: outcome.entry, budgetMicroUsd: caps.per_task };
  }

  /**
   * Closes the run's reservation once the run has ended; never throws. With a report (`usage`
   * given, null when missing): settles at the actual cost, or the full reservation when usage or
   * price is unknown. Without one: released when the run ended before its instructions were
   * fetched (it can't have called a model), else kept in full. `run` is the run as stored after
   * it ended; null when it couldn't be read (then kept in full).
   */
  async close(
    runId: string,
    run: Run | null,
    usage?: RunUsage | null,
    extraMicroUsd = 0,
  ): Promise<void> {
    let entry;
    try {
      entry = await this.ledger.get(runId);
    } catch (err) {
      log("ERROR", "spend entry unreadable; it stays reserved", { runId, error: String(err) });
      return;
    }
    if (!entry || entry.state !== "reserved") return;
    if (run !== null && ACTIVE_RUN_STATUSES.includes(run.status)) {
      // Still going: it stays reserved until the run really ends.
      log("WARNING", "spend close for a run still in flight; it stays reserved", { runId });
      return;
    }
    if (usage === undefined && run !== null && run.startedAt === null) {
      await this.release(runId);
      return;
    }
    let microUsd: number | null = null;
    if (usage !== undefined && run !== null) {
      const model = await this.prices(run.route).catch(() => null);
      const agent = model ? settleFor(model, usage) : null;
      // Spend the report doesn't carry (the executor's helper calls, AI-260), at its cap.
      microUsd = agent === null ? null : agent + extraMicroUsd;
    }
    const at = this.now().toISOString();
    await this.ledger.settle(runId, microUsd, at).then(
      () => log("INFO", "spend settled", { runId, microUsd, keptInFull: microUsd === null }),
      (err: unknown) =>
        log("ERROR", "spend settle failed; it stays reserved", { runId, error: String(err) }),
    );
  }

  /**
   * The run's open reservation in micro-USD: the budget its executor enforces (AI-260). Null
   * when there is none, it is closed, or the ledger can't be read: then the run must not start.
   */
  async reservedFor(runId: string): Promise<number | null> {
    try {
      const entry = await this.ledger.get(runId);
      return entry?.state === "reserved" ? entry.reservedMicroUsd : null;
    } catch (err) {
      log("ERROR", "spend entry unreadable", { runId, error: String(err) });
      return null;
    }
  }

  /**
   * Route fallback found no route because the gate refused them (AI-257, after AI-261): sends
   * the stop notice for the first route refused at a cap, naming the ticket that waits. Re-reads
   * like `refusal`; writes nothing but the notice, which the notice ledger dedupes per cap and
   * window, so a dispatch that keeps idling doesn't repeat it. Never throws.
   */
  async alertStopped(projectId: string, ticketId: string, routes: readonly Route[]): Promise<void> {
    if (!this.alerts) return;
    try {
      for (const route of routes) {
        const checked = await this.check({ id: null, projectId, route });
        if (checked.ok || !checked.stop) continue;
        await this.alert({
          kind: "stopped",
          run: { id: `dispatch:${ticketId}`, projectId, ticketId },
          ...stopOf(checked.stop),
        });
        return;
      }
    } catch (err) {
      log("ERROR", "spend stop alert failed", { projectId, ticketId, error: String(err) });
    }
  }

  /** Tells the spend notices; a failure there is logged and never blocks the gate. */
  private async alert(event: SpendEvent): Promise<void> {
    if (!this.alerts) return;
    await this.alerts(event).catch((err: unknown) =>
      log("ERROR", "spend alert failed", { runId: event.run.id, error: String(err) }),
    );
  }

  /** Releases a reservation; logs (doesn't throw) on failure, so it stays reserved in full. */
  private async release(runId: string): Promise<void> {
    await this.ledger.release(runId, this.now().toISOString()).then(
      () => log("INFO", "spend released", { runId }),
      (err: unknown) =>
        log("ERROR", "spend release failed; it stays reserved", { runId, error: String(err) }),
    );
  }
}
