import {
  DEFAULT_ROUTING,
  DEFAULT_SPEND_CAPS,
  InMemoryCodeHost,
  InMemoryRoutingConfigStore,
  InMemoryRunStore,
  InMemorySpendLedger,
  InMemoryWorkTracker,
  type Route,
  type RoutingConfigInput,
  type Run,
  type Runner,
  type RunUsage,
  type SpendLedger,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildDispatcher } from "./build-dispatch";
import { DomainError } from "./errors";
import { RunService } from "./runs";
import { NO_PRICES, SpendGate, type SpendCapsSource, type SpendPrices } from "./spend-gate";
import { WorkflowExecutor } from "./test-executor";

/** AI-248: M10.7: Spend gate at dispatch. Paid tasks reserve first; everything unknown stops. */

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const NOW = new Date("2026-11-21T12:00:00.000Z");
const PAID: Route = { harness: "opencode", provider: "openrouter", model: "vendor/model-x" };
// $1 per million input tokens, $2 per million output tokens.
const PRICED: SpendPrices = async () => ({ priceInPerMTokUsd: 1, priceOutPerMTokUsd: 2 });
const PER_TASK = DEFAULT_SPEND_CAPS.perTaskMicroUsd;

const usage = (u: Partial<RunUsage> = {}): RunUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: null,
  wallMs: null,
  ...u,
});

describe("spend gate at dispatch", () => {
  let tracker: InMemoryWorkTracker;
  let runStore: InMemoryRunStore;
  let routing: InMemoryRoutingConfigStore;
  let executor: WorkflowExecutor;
  let ledger: InMemorySpendLedger;
  let projectId: string;

  const service = (gate: SpendGate | null) =>
    new RunService(
      tracker,
      runStore,
      executor,
      () => NOW,
      null,
      null,
      null,
      null,
      null,
      null,
      routing,
      gate,
    );
  const gate = (
    prices: SpendPrices = PRICED,
    caps?: SpendCapsSource,
    l: SpendLedger = ledger,
  ): SpendGate => new SpendGate(l, prices, caps, () => NOW);

  /** Every tier on the paid route, so a plan task runs on it. */
  const routePaid = async () => {
    const { providers, tiers, steps } = structuredClone(DEFAULT_ROUTING);
    providers.openrouter.enabled = true;
    const paidTiers = Object.fromEntries(
      Object.keys(tiers).map((k) => [k, [PAID]]),
    ) as typeof tiers;
    const config = (scope: "global" | "project"): RoutingConfigInput => ({
      scope,
      projectId: scope === "global" ? null : projectId,
      providers,
      tiers: paidTiers,
      steps,
    });
    await routing.put(config("global"), null);
    await routing.put(config("project"), null);
  };
  const readyTicket = async () => {
    const t = await tracker.createTicket(
      projectId,
      {
        type: "feature",
        title: "Board",
        body: "Andy can't see his tickets.",
        acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
        size: "M",
        sizeReason: "one screen",
      },
      "andy",
    );
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
  };
  /** A plan task (plan approval "all"), so a report needs no pull request. */
  const startPlan = async (runs: RunService) => {
    const t = await readyTicket();
    return { ticket: t, run: await runs.start(projectId, t.id, "build") };
  };
  const refusal = async (p: Promise<unknown>) => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe("spend_cap");
    return err as DomainError;
  };
  const onlyRun = async () => {
    const all = await runStore.listActive(projectId);
    const ended = await runStore.listForTicket(
      projectId,
      (await tracker.listTickets(projectId))[0]!.id,
    );
    return { active: all, all: ended };
  };
  const reportFailed = (runs: RunService, run: Run, u: RunUsage | null) =>
    runs.report(run.id, run.executor!, {
      status: "succeeded",
      summary: null,
      // Not a plan: the result is rejected (failed, flagged, never retried).
      output: { nope: true },
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      usage: u,
    });

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker(() => NOW);
    runStore = new InMemoryRunStore(() => NOW);
    routing = new InMemoryRoutingConfigStore(() => NOW);
    executor = new WorkflowExecutor(new InMemoryCodeHost([REPO]));
    ledger = new InMemorySpendLedger();
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, { buildEnabled: true, planApproval: "all" });
  });

  describe("subscription routes", () => {
    it("GivenASubscriptionRoute_WhenATaskStartsAndEnds_ThenNothingIsReservedAndTheLedgerIsUntouched", async () => {
      const spies = (["reserve", "totals", "get", "settle", "release"] as const).map((m) =>
        vi.spyOn(ledger, m),
      );
      const start = vi.spyOn(executor, "start");
      const runs = service(gate());
      const { run } = await startPlan(runs);
      expect(run.route.provider).toBe("claude-sub");
      await reportFailed(runs, run, usage({ inputTokens: 10 }));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(start.mock.calls[0]![0]).toMatchObject({ billingType: "subscription" });
      expect(start.mock.calls[0]![0].budgetMicroUsd ?? null).toBeNull();
    });

    it("GivenNoSpendGate_WhenASubscriptionTaskStarts_ThenItStartsAsBefore", async () => {
      const { run } = await startPlan(service(null));
      expect(run.status).toBe("queued");
      expect(run.executor).not.toBeNull();
    });
  });

  describe("reserving before a paid start", () => {
    beforeEach(routePaid);

    it("GivenAPricedPaidRoute_WhenATaskStarts_ThenItsPerTaskCapIsReservedAndPassedAsItsBudget", async () => {
      const start = vi.spyOn(executor, "start");
      const { run } = await startPlan(service(gate()));
      expect(run.route).toEqual(PAID);
      expect(await ledger.get(run.id)).toMatchObject({
        state: "reserved",
        reservedMicroUsd: PER_TASK,
        projectId,
        provider: "openrouter",
        model: PAID.model,
      });
      expect(start.mock.calls[0]![0]).toMatchObject({
        billingType: "pay_per_use",
        budgetMicroUsd: PER_TASK,
      });
    });

    it("GivenNoSpendGate_WhenAPaidTaskStarts_ThenItIsRefusedAndNeverDispatched", async () => {
      const start = vi.spyOn(executor, "start");
      await refusal(startPlan(service(null)));
      expect(start).not.toHaveBeenCalled();
      const { active, all } = await onlyRun();
      expect(active).toEqual([]);
      expect(all[0]).toMatchObject({ status: "failed" });
      expect(all[0]!.error).toContain("no spend ledger");
    });

    it("GivenAModelWithNoPrice_WhenAPaidTaskStarts_ThenItIsRefusedAndNothingIsReserved", async () => {
      const start = vi.spyOn(executor, "start");
      const err = await refusal(startPlan(service(gate(NO_PRICES))));
      expect(err.message).toContain("no price");
      expect(start).not.toHaveBeenCalled();
      const { all } = await onlyRun();
      expect(await ledger.get(all[0]!.id)).toBeNull();
      expect(all[0]).toMatchObject({ status: "failed" });
    });

    it("GivenPricesThatCantBeRead_WhenAPaidTaskStarts_ThenItIsRefused", async () => {
      const broken: SpendPrices = () => Promise.reject(new Error("offline"));
      await refusal(startPlan(service(gate(broken))));
    });

    it("GivenCapsThatCantBeRead_WhenAPaidTaskStarts_ThenItIsRefused", async () => {
      const broken: SpendCapsSource = () => Promise.reject(new Error("offline"));
      const err = await refusal(startPlan(service(gate(PRICED, broken))));
      expect(err.message).toContain("caps");
    });

    it("GivenAProjectDailyCapBelowThePerTaskCap_WhenAPaidTaskStarts_ThenItIsRefusedAtThatCap", async () => {
      const caps: SpendCapsSource = async () => ({
        global: DEFAULT_SPEND_CAPS,
        project: { dailyMicroUsd: PER_TASK - 1 },
      });
      const err = await refusal(startPlan(service(gate(PRICED, caps))));
      expect(err.message).toContain("project_daily");
      const { all } = await onlyRun();
      expect(await ledger.get(all[0]!.id)).toBeNull();
    });

    it("GivenTheGlobalDailyCapAlmostUsed_WhenAPaidTaskStarts_ThenItIsRefusedAtTheGlobalCap", async () => {
      const at = NOW.toISOString();
      const caps = {
        per_task: PER_TASK,
        project_daily: DEFAULT_SPEND_CAPS.dailyMicroUsd,
        project_monthly: DEFAULT_SPEND_CAPS.monthlyMicroUsd,
        global_daily: DEFAULT_SPEND_CAPS.dailyMicroUsd,
        global_monthly: DEFAULT_SPEND_CAPS.monthlyMicroUsd,
      };
      // Another project's tasks used 4 of the 5 dollars today.
      for (const id of ["o1", "o2"]) {
        await ledger.reserve(
          {
            id,
            runId: id,
            projectId: "other",
            provider: "openrouter",
            model: PAID.model,
            state: "reserved",
            reservedMicroUsd: PER_TASK,
            settledMicroUsd: null,
            at,
            settledAt: null,
          },
          caps,
        );
      }
      const err = await refusal(startPlan(service(gate())));
      expect(err.message).toContain("global_daily");
    });

    it("GivenALedgerWhoseTotalsCantBeRead_WhenAPaidTaskStarts_ThenItIsRefused", async () => {
      vi.spyOn(ledger, "totals").mockRejectedValue(new Error("unavailable"));
      const reserve = vi.spyOn(ledger, "reserve");
      const err = await refusal(startPlan(service(gate())));
      expect(err.message).toContain("can't be read");
      expect(reserve).not.toHaveBeenCalled();
    });

    it("GivenALedgerReserveThatFails_WhenAPaidTaskStarts_ThenItIsRefusedAndAnyWriteReleased", async () => {
      const real = ledger.reserve.bind(ledger);
      // The write lands, then the call fails (a timeout after commit).
      vi.spyOn(ledger, "reserve").mockImplementation(async (e, c) => {
        await real(e, c);
        throw new Error("deadline exceeded");
      });
      const start = vi.spyOn(executor, "start");
      await refusal(startPlan(service(gate())));
      expect(start).not.toHaveBeenCalled();
      const { all } = await onlyRun();
      expect(await ledger.get(all[0]!.id)).toMatchObject({ state: "released" });
    });

    it("GivenAPaidTaskRefused_WhenDispatchRuns_ThenTheProjectsLastDecisionIsSpendCap", async () => {
      await tracker.updateProject(projectId, { autoBuild: true, autoRefine: false });
      const runs = service(gate(NO_PRICES));
      const dispatcher = new BuildDispatcher(tracker, runStore, runs, () => NOW, null);
      await readyTicket();
      expect(await dispatcher.next(projectId)).toBeNull();
      expect((await tracker.getProject(projectId))!.lastDispatch?.decision).toBe("spend_cap");
    });
  });

  describe("releasing and settling", () => {
    beforeEach(routePaid);

    it("GivenAReservedTask_WhenItsDispatchFails_ThenItsReservationIsReleased", async () => {
      vi.spyOn(executor, "start").mockRejectedValue(new Error("Actions is down"));
      const err = await startPlan(service(gate())).catch((e: unknown) => e);
      expect((err as DomainError).code).toBe("dispatch_failed");
      const { all } = await onlyRun();
      expect(await ledger.get(all[0]!.id)).toMatchObject({ state: "released" });
    });

    it("GivenAQueuedPaidTask_WhenItsTicketIsCancelled_ThenItsReservationIsReleased", async () => {
      const runs = service(gate());
      const { run, ticket } = await startPlan(runs);
      await runs.cancelForTicket(projectId, ticket.id);
      expect(await ledger.get(run.id)).toMatchObject({ state: "released" });
    });

    it("GivenARunningPaidTask_WhenItsTicketIsCancelled_ThenItsFullReservationIsKept", async () => {
      const runs = service(gate());
      const { run, ticket } = await startPlan(runs);
      await runs.context(run.id, run.executor!);
      await runs.cancelForTicket(projectId, ticket.id);
      expect(await ledger.get(run.id)).toMatchObject({
        state: "settled",
        settledMicroUsd: PER_TASK,
      });
    });

    it("GivenAReportWithUsage_WhenItArrives_ThenTheEntryIsSettledAtTheActualCost", async () => {
      const runs = service(gate());
      const { run } = await startPlan(runs);
      await runs.context(run.id, run.executor!);
      // 100,000 × $1/M + 10,000 × $2/M = 100,000 + 20,000 micro-USD
      await reportFailed(runs, run, usage({ inputTokens: 100_000, outputTokens: 10_000 }));
      expect(await ledger.get(run.id)).toMatchObject({
        state: "settled",
        settledMicroUsd: 120_000,
      });
    });

    it("GivenAReportWithoutUsage_WhenItArrives_ThenTheFullReservationIsKept", async () => {
      const runs = service(gate());
      const { run } = await startPlan(runs);
      await runs.context(run.id, run.executor!);
      await reportFailed(runs, run, null);
      expect(await ledger.get(run.id)).toMatchObject({
        state: "settled",
        settledMicroUsd: PER_TASK,
      });
    });

    it("GivenAReportWhosePriceIsGoneBySettlement_WhenItArrives_ThenTheFullReservationIsKept", async () => {
      let priced = true;
      const flaky: SpendPrices = async (r) => (priced ? PRICED(r) : null);
      const runs = service(gate(flaky));
      const { run } = await startPlan(runs);
      priced = false;
      await reportFailed(runs, run, usage({ inputTokens: 1 }));
      expect(await ledger.get(run.id)).toMatchObject({ settledMicroUsd: PER_TASK });
    });
  });

  describe("a crash between ending a run and closing its spend", () => {
    beforeEach(routePaid);

    /** The next terminal run write lands, then the process "dies" before anything after it. */
    const crashAfterTheEndWrite = () => {
      const real = runStore.update.bind(runStore);
      const spy = vi.spyOn(runStore, "update").mockImplementation(async (id, patch, from) => {
        const written = await real(id, patch, from);
        if (patch.endedAt) {
          spy.mockRestore();
          throw new Error("process killed");
        }
        return written;
      });
    };

    it("GivenAReportThatCrashedAfterEndingTheRun_WhenTheReportIsReplayed_ThenItSettlesAtTheActualCost", async () => {
      const runs = service(gate());
      const { run } = await startPlan(runs);
      await runs.context(run.id, run.executor!);
      const u = usage({ inputTokens: 100_000, outputTokens: 10_000 });
      crashAfterTheEndWrite();
      await expect(reportFailed(runs, run, u)).rejects.toThrow("process killed");
      expect(await ledger.get(run.id)).toMatchObject({ state: "reserved" });
      expect(await reportFailed(runs, run, u)).toBe("duplicate");
      expect(await ledger.get(run.id)).toMatchObject({
        state: "settled",
        settledMicroUsd: 120_000,
      });
    });

    it("GivenAReportThatCrashedAfterEndingTheRun_WhenTheWatchdogChecks_ThenTheFullReservationIsKept", async () => {
      const runs = service(gate());
      const { run } = await startPlan(runs);
      await runs.context(run.id, run.executor!);
      crashAfterTheEndWrite();
      await expect(reportFailed(runs, run, null)).rejects.toThrow("process killed");
      expect(await runs.checkDeadline(run.id)).toBe("settled");
      expect(await ledger.get(run.id)).toMatchObject({
        state: "settled",
        settledMicroUsd: PER_TASK,
      });
    });

    it("GivenACancelThatCrashedBeforeTheRunStarted_WhenTheWatchdogChecks_ThenItIsReleased", async () => {
      const runs = service(gate());
      const { run, ticket } = await startPlan(runs);
      crashAfterTheEndWrite();
      await expect(runs.cancelForTicket(projectId, ticket.id)).rejects.toThrow("process killed");
      expect(await ledger.get(run.id)).toMatchObject({ state: "reserved" });
      await runs.checkDeadline(run.id);
      expect(await ledger.get(run.id)).toMatchObject({ state: "released" });
    });

    it("GivenAClosedReservation_WhenTheWatchdogChecksAgain_ThenNothingChanges", async () => {
      const runs = service(gate());
      const { run } = await startPlan(runs);
      await runs.context(run.id, run.executor!);
      await reportFailed(runs, run, usage({ outputTokens: 1 }));
      const settled = await ledger.get(run.id);
      await runs.checkDeadline(run.id);
      expect(await ledger.get(run.id)).toEqual(settled);
    });
  });

  describe("the local runner", () => {
    beforeEach(routePaid);

    it("GivenAPaidRoute_WhenTheLocalRunnerClaimsATask_ThenItIsRefusedAndNothingIsReserved", async () => {
      await tracker.updateProject(projectId, { executor: "local" });
      const runner = { id: "r1", name: "mac", projectIds: [projectId] } as Runner;
      const t = await readyTicket();
      const err = await refusal(
        service(gate()).start(projectId, t.id, "build", undefined, { runner }),
      );
      expect(err.message).toContain("local runner");
      const { all } = await onlyRun();
      expect(all[0]).toMatchObject({ status: "failed" });
      expect(await ledger.get(all[0]!.id)).toBeNull();
    });
  });

  describe("closing never loses a reservation", () => {
    const reserved = async (g: SpendGate) => {
      await routePaid();
      const runs = service(g);
      const { run } = await startPlan(runs);
      return run;
    };

    it("GivenALedgerThatCantBeRead_WhenARunCloses_ThenItStaysReservedAndNothingThrows", async () => {
      const g = gate();
      const run = await reserved(g);
      vi.spyOn(ledger, "get").mockRejectedValueOnce(new Error("unavailable"));
      await expect(
        g.close(run.id, { ...run, status: "failed" }, undefined),
      ).resolves.toBeUndefined();
      expect(await ledger.get(run.id)).toMatchObject({ state: "reserved" });
    });

    it("GivenARunStillInFlight_WhenItsSpendIsClosed_ThenItStaysReserved", async () => {
      const g = gate();
      const run = await reserved(g);
      await g.close(run.id, run, undefined);
      expect(await ledger.get(run.id)).toMatchObject({ state: "reserved" });
    });

    it("GivenARunThatCantBeRead_WhenItsSpendIsClosed_ThenTheFullReservationIsKept", async () => {
      const g = gate();
      const run = await reserved(g);
      await g.close(run.id, null, undefined);
      expect(await ledger.get(run.id)).toMatchObject({ settledMicroUsd: PER_TASK });
    });

    it("GivenAReleaseThatFails_WhenANeverStartedRunCloses_ThenItStaysReservedAndNothingThrows", async () => {
      const g = gate();
      const run = await reserved(g);
      vi.spyOn(ledger, "release").mockRejectedValueOnce(new Error("unavailable"));
      await expect(g.close(run.id, { ...run, status: "failed" })).resolves.toBeUndefined();
      expect(await ledger.get(run.id)).toMatchObject({ state: "reserved" });
    });

    it("GivenASettleThatFails_WhenAReportCloses_ThenItStaysReservedAndNothingThrows", async () => {
      const g = gate();
      const run = await reserved(g);
      vi.spyOn(ledger, "settle").mockRejectedValueOnce(new Error("unavailable"));
      const ended = { ...run, status: "failed" as const, startedAt: NOW.toISOString() };
      await expect(g.close(run.id, ended, usage())).resolves.toBeUndefined();
      expect(await ledger.get(run.id)).toMatchObject({ state: "reserved" });
    });
  });
});
