import {
  DEFAULT_ROUTING,
  InMemoryCodeHost,
  InMemoryQuotaStore,
  InMemoryRoutingConfigStore,
  InMemoryRunStore,
  InMemorySpendLedger,
  InMemorySpendNoticeLedger,
  InMemoryWorkTracker,
  type Notice,
  type Route,
  type SpendLedger,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildDispatcher } from "./build-dispatch";
import { RunService } from "./runs";
import { SpendGate, type SpendPrices } from "./spend-gate";
import { SpendAlerts } from "./spend-notices";
import { WorkflowExecutor } from "./test-executor";

/**
 * AI-257 with AI-261's route fallback: a dispatched start previews the spend gate before any run
 * exists, so the stop notice must come from dispatch too, and a preview that passes while
 * `reserve` refuses must leave no orphan run.
 */

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const NOW = new Date("2026-11-21T12:00:00.000Z");
const USD = 1_000_000;
const PAID: Route = { harness: "opencode", provider: "openrouter", model: "vendor/model-x" };
const PRICED: SpendPrices = async () => ({ priceInPerMTokUsd: 1, priceOutPerMTokUsd: 2 });
const NO_LIMITS = {
  per_task: null,
  project_daily: null,
  project_monthly: null,
  global_daily: null,
  global_monthly: null,
};

describe("spend notices at dispatch (route fallback)", () => {
  let tracker: InMemoryWorkTracker;
  let runStore: InMemoryRunStore;
  let routing: InMemoryRoutingConfigStore;
  let ledger: InMemorySpendLedger;
  let projectId: string;
  let sent: Notice[];

  const dispatcher = (l: SpendLedger = ledger) => {
    const alerts = new SpendAlerts({
      tracker,
      ledger: new InMemorySpendNoticeLedger(),
      notifier: { notify: async (n) => void sent.push(n) },
      appUrl: "https://ai.example.com",
      now: () => NOW,
    });
    const gate = new SpendGate(
      l,
      PRICED,
      undefined,
      () => NOW,
      (e) => alerts.handle(e),
    );
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
      gate,
    );
    return new BuildDispatcher(tracker, runStore, runs, () => NOW, new InMemoryQuotaStore());
  };
  /** Every tier on the paid route only. */
  const routeOnlyPaid = async () => {
    const { providers, tiers, steps } = structuredClone(DEFAULT_ROUTING);
    providers.openrouter.enabled = true;
    const paid = Object.fromEntries(Object.keys(tiers).map((k) => [k, [PAID]])) as typeof tiers;
    await routing.put({ scope: "global", projectId: null, providers, tiers: paid, steps }, null);
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
  /** Spends `usd` today in the project, outside any run. */
  const spendToday = (usd: number) =>
    ledger.reserve(
      {
        id: `earlier-${usd}`,
        runId: `earlier-${usd}`,
        projectId,
        provider: "openrouter",
        model: "vendor/model-x",
        state: "reserved",
        reservedMicroUsd: usd * USD,
        settledMicroUsd: null,
        at: NOW.toISOString(),
        settledAt: null,
      },
      NO_LIMITS,
    );
  const decision = async () => (await tracker.getProject(projectId))!.lastDispatch?.decision;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker(() => NOW);
    runStore = new InMemoryRunStore(() => NOW);
    routing = new InMemoryRoutingConfigStore(() => NOW);
    ledger = new InMemorySpendLedger();
    sent = [];
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, {
      buildEnabled: true,
      autoBuild: true,
      autoRefine: false,
      planApproval: "all",
    });
  });

  it("GivenTheOnlyPaidRouteAtItsCap_WhenDispatchRuns_ThenItIdlesAndOneStopNoticeNamesTheTicket", async () => {
    await routeOnlyPaid();
    await spendToday(4); // $4 of $5 today: a $2 task would pass the daily cap.
    const t = await readyTicket();
    const dispatch = dispatcher();
    expect(await dispatch.next(projectId)).toBeNull();
    expect(await decision()).toBe("spend_cap");
    expect(await runStore.listForTicket(projectId, t.id)).toEqual([]);
    const stops = sent.filter((n) => n.urgency === "high");
    expect(stops).toEqual([
      expect.objectContaining({
        title: "AI: paid tasks stopped at the daily spend cap",
        body: `Waiting: ${t.key}. Raise the cap in project settings or wait for the next window.`,
      }),
    ]);
    // At $4 of $5 the same event also carries the 80% warnings (project and global daily).
    expect(sent.filter((n) => n.urgency === "normal").map((n) => n.title)).toEqual([
      "AI: 80% of the daily spend cap",
      "All projects: 80% of the global daily spend cap",
    ]);
    // Dispatch keeps idling on the cap; the notice ledger keeps it to one.
    await dispatch.next(projectId);
    expect(sent).toHaveLength(3);
  });

  it("GivenThePreviewPassesButReserveRefuses_WhenDispatchRuns_ThenNoOrphanRunAndTheSameIdle", async () => {
    await routeOnlyPaid();
    const t = await readyTicket();
    // The race the preview can't see: totals read clear, but the ledger's own atomic check refuses.
    const racing: SpendLedger = Object.assign(new InMemorySpendLedger(), {
      reserve: async () =>
        ({
          ok: false,
          cap: "global_daily",
          limitMicroUsd: 5 * USD,
          usedMicroUsd: 4 * USD,
        }) as const,
    });
    expect(await dispatcher(racing).next(projectId)).toBeNull();
    expect(await decision()).toBe("spend_cap");
    const runs = await runStore.listForTicket(projectId, t.id);
    expect(runs.map((r) => r.status)).toEqual(["failed"]);
    expect(await racing.get(runs[0]!.id)).toBeNull();
    expect(sent.map((n) => n.title)).toEqual([
      "All projects: paid tasks stopped at the global daily spend cap",
    ]);
  });
});
