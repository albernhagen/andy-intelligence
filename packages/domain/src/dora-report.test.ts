import {
  DEPLOYMENT_LIMITS,
  InMemoryDeploymentStore,
  InMemoryWorkTracker,
  type Deployment,
} from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { DoraReader, buildDoraReport, doraDeployments } from "./dora-report";

const NOW = new Date("2026-11-21T00:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

let n = 0;
const dep = (over: Partial<Deployment>): Deployment => ({
  id: `d${++n}`,
  projectId: "ai",
  environment: "prod",
  imageDigest: `sha256:${"a".repeat(64)}`,
  gitSha: "b".repeat(40),
  revision: null,
  kind: "deploy",
  status: "succeeded",
  startedAt: daysAgo(1),
  finishedAt: daysAgo(1),
  actor: "system",
  previousDeploymentId: null,
  ...over,
});

describe("DORA report from deployment records (AI-200)", () => {
  it("GivenDeploysPromotesAndFailedStarts_WhenMapped_ThenOnlySucceededProdDeploysCount", () => {
    const records = [
      dep({ kind: "deploy" }),
      dep({ kind: "promote" }),
      dep({ status: "failed" }),
      dep({ status: "started", finishedAt: null }),
      dep({ environment: "dev" }),
    ];

    expect(doraDeployments(records)).toHaveLength(2);
  });

  it("GivenARollback_WhenMapped_ThenTheReplacedDeployFailedAndWasRestoredAtTheRollback", () => {
    const bad = dep({ finishedAt: daysAgo(2), startedAt: daysAgo(2) });
    const rollback = dep({
      kind: "rollback",
      previousDeploymentId: bad.id,
      startedAt: daysAgo(1.9),
      finishedAt: daysAgo(1.875),
    });

    const inputs = doraDeployments([rollback, bad]);

    expect(inputs).toEqual([
      {
        deployedAt: bad.finishedAt,
        changeCommittedAt: [],
        failed: true,
        restoredAt: daysAgo(1.875),
      },
    ]);
  });

  it("GivenDeploysAcrossNinetyDays_WhenReported_ThenThirtyAndNinetyDayWindowsDiffer", () => {
    const bad = dep({ startedAt: daysAgo(10), finishedAt: daysAgo(10) });
    const records = [
      dep({ startedAt: daysAgo(1), finishedAt: daysAgo(1) }),
      dep({
        kind: "rollback",
        previousDeploymentId: bad.id,
        startedAt: daysAgo(9.5),
        finishedAt: daysAgo(9.5),
      }),
      bad,
      dep({ startedAt: daysAgo(60), finishedAt: daysAgo(60) }),
      dep({ startedAt: daysAgo(120), finishedAt: daysAgo(120) }),
    ];

    const report = buildDoraReport("AI", records, records[0]!, NOW, false);

    const [d30, d90] = report.windows;
    expect(d30).toMatchObject({ days: 30, to: NOW.toISOString(), from: daysAgo(30) });
    expect(d30!.metrics).toMatchObject({
      deployments: 2,
      changeFailureRate: 0.5,
      timeToRestoreHours: { median: 12, count: 1, open: 0 },
    });
    expect(d90!.metrics.deployments).toBe(3);
    expect(report).toMatchObject({ leadTimeMeasured: false, partial: false });
    expect(report.latestGood).toEqual({ gitSha: "b".repeat(40), finishedAt: daysAgo(1) });
  });

  it("GivenNoDeployments_WhenReported_ThenEmptyWindowsAndNoLatestGood", () => {
    const report = buildDoraReport("AI", [], null, NOW, false);

    expect(report.windows.map((w) => w.metrics.deployments)).toEqual([0, 0]);
    expect(report.windows[0]!.metrics.changeFailureRate).toBeNull();
    expect(report.latestGood).toBeNull();
  });

  it("GivenAFullPageNewerThanNinetyDays_WhenReported_ThenPartial", () => {
    const records = [dep({ startedAt: daysAgo(1) }), dep({ startedAt: daysAgo(5) })];

    expect(buildDoraReport("AI", records, null, NOW, true).partial).toBe(true);
    const older = [...records, dep({ startedAt: daysAgo(100) })];
    expect(buildDoraReport("AI", older, null, NOW, true).partial).toBe(false);
  });
});

describe("DORA reader (AI-200)", () => {
  async function seed() {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "AI", key: "AI" });
    return { tracker, store: new InMemoryDeploymentStore() };
  }

  it("GivenProdDeployments_WhenRead_ThenOnePageOfProdAndTheLatestGoodAreUsed", async () => {
    const { tracker, store } = await seed();
    const { id, ...fresh } = dep({ startedAt: daysAgo(2), finishedAt: daysAgo(2) });
    expect(id).toBeTruthy();
    await store.record(fresh);
    await store.record({ ...fresh, environment: "dev" });
    let pageAsked: number | undefined;
    const counting = {
      list: (p: string, e: "prod" | "dev" | "preview", limit?: number) => {
        pageAsked = limit;
        return store.list(p, e, limit);
      },
      latestGood: store.latestGood.bind(store),
    };

    const report = await new DoraReader(tracker, counting, () => NOW).report("ai");

    expect(pageAsked).toBe(DEPLOYMENT_LIMITS.maxPage);
    expect(report.windows[0]!.metrics.deployments).toBe(1);
    expect(report.latestGood?.finishedAt).toBe(daysAgo(2));
  });

  it("GivenNoDeploymentStore_WhenRead_ThenEmptyReport", async () => {
    const { tracker } = await seed();

    const report = await new DoraReader(tracker, null, () => NOW).report("ai");

    expect(report.windows.every((w) => w.metrics.deployments === 0)).toBe(true);
  });

  it("GivenAnUnknownProject_WhenRead_ThenNotFound", async () => {
    const { tracker, store } = await seed();
    await expect(new DoraReader(tracker, store).report("nope")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
