import {
  DEFAULT_ROUTING,
  DEFAULT_SPEND_CAPS,
  InMemoryCodeHost,
  InMemoryQuotaStore,
  InMemoryRoutingConfigStore,
  InMemoryRunStore,
  InMemorySpendLedger,
  InMemoryWorkTracker,
  type QuotaReading,
  type Route,
  type Runner,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildDispatcher } from "./build-dispatch";
import { RunService } from "./runs";
import { NO_PRICES, SpendGate, type SpendCapsSource, type SpendPrices } from "./spend-gate";
import { WorkflowExecutor } from "./test-executor";

/** AI-261: M10.14: dispatch skips routes at their reserve or a spend cap, and records why. */

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const NOW = new Date("2026-11-21T12:00:00.000Z");
const OPUS: Route = { harness: "claude-code", provider: "claude-sub", model: "opus" };
const PAID: Route = { harness: "opencode", provider: "openrouter", model: "vendor/model-x" };
const PRICED: SpendPrices = async () => ({ priceInPerMTokUsd: 1, priceOutPerMTokUsd: 2 });
const PAUSE_REASON = "claude-sub quota is at its pause level (80% used), keeping the reserve";

const claudeReading = (
  usedPct: number,
  takenAt = NOW,
  window: "5h" | "weekly" = "5h",
): QuotaReading => ({
  provider: "claude-sub",
  window,
  usedPct,
  resetsAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
  source: "test",
  takenAt: takenAt.toISOString(),
  confidence: "high",
});

describe("quota-aware route fallback at dispatch", () => {
  let tracker: InMemoryWorkTracker;
  let runStore: InMemoryRunStore;
  let routing: InMemoryRoutingConfigStore;
  let ledger: InMemorySpendLedger;
  let quota: InMemoryQuotaStore;
  let projectId: string;

  const dispatcher = (prices: SpendPrices = PRICED, caps?: SpendCapsSource) => {
    const runs = new RunService(
      tracker,
      runStore,
      new WorkflowExecutor(new InMemoryCodeHost([REPO])),
      () => NOW,
      null,
      null,
      null,
      null,
      null,
      null,
      routing,
      new SpendGate(ledger, prices, caps, () => NOW),
    );
    return { runs, dispatch: new BuildDispatcher(tracker, runStore, runs, () => NOW, quota) };
  };
  /** Every tier tries Opus on the subscription first, then the paid route. */
  const routeOpusThenPaid = async () => {
    const { providers, tiers, steps } = structuredClone(DEFAULT_ROUTING);
    providers.openrouter.enabled = true;
    const both = Object.fromEntries(
      Object.keys(tiers).map((k) => [k, [OPUS, PAID]]),
    ) as typeof tiers;
    await routing.put({ scope: "global", projectId: null, providers, tiers: both, steps }, null);
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
  const decision = async () => (await tracker.getProject(projectId))!.lastDispatch?.decision;
  const runsOf = (ticketId: string) => runStore.listForTicket(projectId, ticketId);

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker(() => NOW);
    runStore = new InMemoryRunStore(() => NOW);
    routing = new InMemoryRoutingConfigStore(() => NOW);
    ledger = new InMemorySpendLedger();
    quota = new InMemoryQuotaStore();
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, {
      buildEnabled: true,
      autoBuild: true,
      autoRefine: false,
      planApproval: "all",
    });
  });

  it("GivenClaudeSubAtItsPauseLevel_WhenDispatchRuns_ThenTheNextRouteStartsAndTheSkipIsOnTheRun", async () => {
    await routeOpusThenPaid();
    await quota.save([claudeReading(85)]);
    const t = await readyTicket();
    const run = await dispatcher().dispatch.next(projectId);
    expect(run).toMatchObject({
      route: PAID,
      routeSkips: [{ route: OPUS, reason: PAUSE_REASON }],
    });
    const comments = (await tracker.listEvents(projectId, t.id))
      .filter((e) => e.kind === "comment")
      .map((e) => e.body ?? "");
    expect(
      comments.some((c) => c.includes(`claude-code/claude-sub/opus skipped: ${PAUSE_REASON}`)),
    ).toBe(true);
    expect(await ledger.get(run!.id)).toMatchObject({ state: "reserved" });
  });

  it("GivenTheReserveReachedAndThePaidRouteUnpriced_WhenDispatchRuns_ThenNothingStartsAndQuotaReserveIsKept", async () => {
    await routeOpusThenPaid();
    await quota.save([claudeReading(85)]);
    const t = await readyTicket();
    expect(await dispatcher(NO_PRICES).dispatch.next(projectId)).toBeNull();
    expect(await decision()).toBe("quota_reserve");
    expect(await runsOf(t.id)).toEqual([]);
    expect((await tracker.getTicket(projectId, t.id))!.needsAttention).toBe(false);
  });

  it("GivenOnlyAPaidRouteThatWouldPassACap_WhenDispatchRuns_ThenItIsNeverStartedAndSpendCapIsKept", async () => {
    await routeOpusThenPaid();
    // Claude Code off: only the paid route is left.
    const global = (await routing.getGlobal())!;
    global.providers["claude-sub"].enabled = false;
    await routing.put(
      {
        scope: "global",
        projectId: null,
        providers: global.providers,
        tiers: global.tiers,
        steps: global.steps,
      },
      global.updatedAt,
    );
    const caps: SpendCapsSource = async () => ({
      global: DEFAULT_SPEND_CAPS,
      project: { dailyMicroUsd: DEFAULT_SPEND_CAPS.perTaskMicroUsd - 1 },
    });
    const t = await readyTicket();
    expect(await dispatcher(PRICED, caps).dispatch.next(projectId)).toBeNull();
    expect(await decision()).toBe("spend_cap");
    expect(await runsOf(t.id)).toEqual([]);
  });

  it("GivenAStaleClaudeSubReadingAndAPaidRouteWithRoom_WhenDispatchRuns_ThenThePaidRouteIsPreferred", async () => {
    await routeOpusThenPaid();
    await quota.save([claudeReading(10, new Date(NOW.getTime() - 7 * 3_600_000))]);
    await readyTicket();
    const run = await dispatcher().dispatch.next(projectId);
    expect(run?.route).toEqual(PAID);
    expect(run?.routeSkips[0]?.reason).toContain("stale or missing; preferred a route with room");
  });

  it("GivenAFreshReadingWithRoom_WhenDispatchRuns_ThenTheFirstRouteAndNoSkips", async () => {
    await routeOpusThenPaid();
    await quota.save([claudeReading(10), claudeReading(30, NOW, "weekly")]);
    await readyTicket();
    const run = await dispatcher().dispatch.next(projectId);
    expect(run).toMatchObject({ route: OPUS, routeSkips: [] });
  });

  it("GivenTheDefaultRoutingAndNoReadings_WhenDispatchRuns_ThenOpusAsToday", async () => {
    await readyTicket();
    const run = await dispatcher().dispatch.next(projectId);
    expect(run).toMatchObject({ route: OPUS, routeSkips: [] });
  });

  it("GivenTheReserveReached_WhenAndyStartsByHand_ThenTheResolversRouteAsBefore", async () => {
    await routeOpusThenPaid();
    await quota.save([claudeReading(85)]);
    const t = await readyTicket();
    const run = await dispatcher().runs.start(projectId, t.id, "build");
    expect(run.route).toEqual(OPUS);
  });

  describe("a local runner's claim", () => {
    const runner = () => ({ id: "r1", name: "mac", projectIds: [projectId] }) as Runner;

    it("GivenTheReserveReachedAndOnlyAPaidRouteLeft_WhenTheRunnerClaims_ThenNothingStartsAndNothingIsFlagged", async () => {
      await tracker.updateProject(projectId, { executor: "local" });
      await routeOpusThenPaid();
      await quota.save([claudeReading(85)]);
      const t = await readyTicket();
      const before = await decision();
      // The paid route is skipped on the local runner (no budget harness), so the reserve idles it.
      expect(await dispatcher().dispatch.claimFor(projectId, runner())).toBeNull();
      expect(await runsOf(t.id)).toEqual([]);
      expect((await tracker.getTicket(projectId, t.id))!.needsAttention).toBe(false);
      // A claim never rewrites the project's last decision (the cloud's), as before.
      expect(await decision()).toBe(before);
    });

    it("GivenOnlyAPaidRoute_WhenTheRunnerClaims_ThenItIsNeverStarted", async () => {
      await tracker.updateProject(projectId, { executor: "local" });
      await routeOpusThenPaid();
      const global = (await routing.getGlobal())!;
      global.providers["claude-sub"].enabled = false;
      await routing.put(
        {
          scope: "global",
          projectId: null,
          providers: global.providers,
          tiers: global.tiers,
          steps: global.steps,
        },
        global.updatedAt,
      );
      const t = await readyTicket();
      expect(await dispatcher().dispatch.claimFor(projectId, runner())).toBeNull();
      expect(await runsOf(t.id)).toEqual([]);
      expect((await tracker.getTicket(projectId, t.id))!.needsAttention).toBe(false);
    });
  });
});
