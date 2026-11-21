import {
  DEFAULT_ROUTING,
  InMemoryCodeHost,
  InMemoryRoutingConfigStore,
  InMemoryRunStore,
  InMemorySpendLedger,
  InMemoryWorkTracker,
  RoutingConfig,
  type Route,
  type RoutingConfigInput,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectiveRouting, resolveRoute } from "./route-resolver";
import { PROVIDER_BILLING, RunService } from "./runs";
import { SpendGate, type SpendPrices } from "./spend-gate";
import { WorkflowExecutor } from "./test-executor";

/** AI-260: M10.13: the API-key Claude provider: off by default, pay-per-use, under a budget. */

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const NOW = new Date("2026-11-21T12:00:00.000Z");
const API: Route = { harness: "claude-code", provider: "claude-api", model: "opus" };
const PRICED: SpendPrices = async () => ({ priceInPerMTokUsd: 5, priceOutPerMTokUsd: 25 });

describe("the claude-api provider in routing", () => {
  it("GivenTheDefaultRouting_WhenRead_ThenClaudeApiIsOffAndBillsPayPerUse", () => {
    expect(DEFAULT_ROUTING.providers["claude-api"].enabled).toBe(false);
    expect(PROVIDER_BILLING["claude-api"]).toBe("pay_per_use");
  });

  it("GivenAConfigStoredBeforeClaudeApi_WhenRead_ThenItReadsAsOff", () => {
    const old = structuredClone(DEFAULT_ROUTING) as { providers: Record<string, unknown> };
    delete old.providers["claude-api"];
    expect(RoutingConfig.parse(old).providers["claude-api"].enabled).toBe(false);
  });

  it("GivenClaudeApiFirstInATierButOff_WhenRouted_ThenItIsSkippedForTheSubscription", () => {
    const c = structuredClone(DEFAULT_ROUTING);
    c.tiers.strong = [API, ...c.tiers.strong];
    const resolved = resolveRoute("build", "strong", effectiveRouting(c, null));
    expect(resolved.route?.provider).toBe("claude-sub");
    expect(resolved.skipped[0]?.reason).toContain("claude-api is off");
  });

  it("GivenClaudeApiTheOnlyRouteAndOff_WhenRouted_ThenThereIsNoRoute", () => {
    const c = structuredClone(DEFAULT_ROUTING);
    c.tiers.strong = [API];
    expect(resolveRoute("build", "strong", effectiveRouting(c, null)).route).toBeNull();
  });

  it("GivenClaudeApiOn_WhenRouted_ThenItIsUsed", () => {
    const c = structuredClone(DEFAULT_ROUTING);
    c.providers["claude-api"].enabled = true;
    c.tiers.strong = [API];
    expect(resolveRoute("build", "strong", effectiveRouting(c, null)).route).toEqual(API);
  });
});

describe("a claude-api agent task", () => {
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
  const startPlan = async (runs: RunService) => {
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
    await tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
    return runs.start(projectId, t.id, "build");
  };

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker(() => NOW);
    runStore = new InMemoryRunStore(() => NOW);
    routing = new InMemoryRoutingConfigStore(() => NOW);
    executor = new WorkflowExecutor(new InMemoryCodeHost([REPO]));
    ledger = new InMemorySpendLedger();
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, { buildEnabled: true, planApproval: "all" });
    const { providers, tiers, steps } = structuredClone(DEFAULT_ROUTING);
    providers["claude-api"].enabled = true;
    const onApi = Object.fromEntries(Object.keys(tiers).map((k) => [k, [API]])) as typeof tiers;
    for (const scope of ["global", "project"] as const) {
      const config: RoutingConfigInput = {
        scope,
        projectId: scope === "global" ? null : projectId,
        providers,
        tiers: onApi,
        steps,
      };
      await routing.put(config, null);
    }
  });

  it("GivenAClaudeApiRoute_WhenATaskStarts_ThenItIsDispatchedPayPerUseWithItsBudget", async () => {
    const start = vi.spyOn(executor, "start");
    const run = await startPlan(service(new SpendGate(ledger, PRICED, undefined, () => NOW)));
    expect(run.route).toEqual(API);
    expect(start.mock.calls[0]![0]).toMatchObject({
      billingType: "pay_per_use",
      budgetMicroUsd: 2_000_000,
    });
  });

  it("GivenAReservedClaudeApiTask_WhenItReadsItsContext_ThenItGetsPayPerUseAndItsBudgetInUsd", async () => {
    const runs = service(new SpendGate(ledger, PRICED, undefined, () => NOW));
    const run = await startPlan(runs);
    const context = await runs.context(run.id, run.executor!);
    expect(context).toMatchObject({ billingType: "pay_per_use", maxBudgetUsd: 2 });
  });

  it("GivenAClaudeApiTaskWhoseReservationIsGone_WhenItReadsItsContext_ThenItIsRefusedAndNotStarted", async () => {
    const runs = service(new SpendGate(ledger, PRICED, undefined, () => NOW));
    const run = await startPlan(runs);
    await ledger.release(run.id, NOW.toISOString());
    await expect(runs.context(run.id, run.executor!)).rejects.toMatchObject({ code: "spend_cap" });
    expect((await runStore.get(run.id))!.startedAt).toBeNull();
  });

  it("GivenNoPriceForClaudeApi_WhenATaskStarts_ThenItIsRefused", async () => {
    await expect(
      startPlan(
        service(
          new SpendGate(
            ledger,
            async () => null,
            undefined,
            () => NOW,
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: "spend_cap" });
  });

  it("GivenASubscriptionTask_WhenItReadsItsContext_ThenItHasNoBudget", async () => {
    routing = new InMemoryRoutingConfigStore(() => NOW);
    const runs = service(new SpendGate(ledger, PRICED, undefined, () => NOW));
    const run = await startPlan(runs);
    const context = await runs.context(run.id, run.executor!);
    expect(context).toMatchObject({ billingType: "subscription", maxBudgetUsd: null });
  });
});
