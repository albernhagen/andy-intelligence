import {
  InMemoryRunStore,
  InMemoryWorkTracker,
  buildRun,
  type Run,
  type RunMetrics,
  type Ticket,
  type TicketEvent,
} from "@andy/contracts";
import { describe, expect, it } from "vitest";
import {
  DashboardReader,
  MAX_DASHBOARD_PROJECTS,
  MAX_DASHBOARD_TICKET_READS,
  dashboardFigures,
  dashboardWindow,
  type DashboardData,
} from "./dashboard";

// A Thursday; with two weeks the window is Mon 2 Nov to now, split at Mon 9 Nov.
const NOW = new Date("2026-11-12T12:00:00.000Z");
const WINDOW = dashboardWindow(NOW, 2);
const WEEK1 = "2026-11-03T12:00:00.000Z";
const WEEK2 = "2026-11-10T12:00:00.000Z";
const BEFORE = "2026-10-20T12:00:00.000Z";
const USAGE = {
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 10,
  cacheWriteTokens: 5,
  turns: 7,
  wallMs: 1000,
};

const ticket = (n: number, over: Partial<Ticket> = {}): Ticket =>
  ({
    id: `t${n}`,
    projectId: "ai",
    key: `AI-${n}`,
    title: `Ticket ${n}`,
    type: "feature",
    stage: "backlog",
    size: "M",
    archived: false,
    createdAt: BEFORE,
    updatedAt: BEFORE,
    ...over,
  }) as Ticket;

const move = (ticketId: string, from: string, to: string, at: string): TicketEvent => ({
  id: `${ticketId}-${at}-${to}`,
  ticketId,
  kind: "stage_changed",
  actor: "system",
  runId: null,
  body: null,
  data: { from, to, forced: false },
  createdAt: at,
});

const metrics = (over: Partial<RunMetrics>): RunMetrics => ({
  ciGreenFirstTry: null,
  reviewFailures: [],
  reviewBlockers: null,
  andyCommits: null,
  reworks: null,
  costEstimateUsd: null,
  ...over,
});

const run = (id: string, over: Partial<Run> = {}): Run => ({
  ...buildRun(
    {
      projectId: "ai",
      ticketId: "t1",
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: null,
    },
    id,
    new Date(WEEK1),
  ),
  status: "succeeded",
  endedAt: WEEK1,
  costUsd: 1,
  usage: USAGE,
  ...over,
});

const data = (over: Partial<DashboardData> = {}): DashboardData => ({
  tickets: [],
  ticketEvents: new Map(),
  endedRuns: [],
  partial: [],
  ...over,
});

describe("dashboardWindow (AI-102)", () => {
  it("GivenAThursday_WhenTwoWeeksAreAsked_ThenTheWindowStartsOnTheEarlierMondayAndEndsNow", () => {
    expect(WINDOW.from.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(WINDOW.to).toBe(NOW);
    expect(WINDOW.weeks).toBe(2);
  });

  it("GivenNoWeeks_WhenTheWindowIsBuilt_ThenItCoversEightWeeks", () => {
    expect(dashboardWindow(NOW).weeks).toBe(8);
  });

  it("GivenTooManyWeeks_WhenTheWindowIsBuilt_ThenItIsClampedToTwentySix", () => {
    expect(dashboardWindow(NOW, 500).weeks).toBe(26);
    expect(dashboardWindow(NOW, 0).weeks).toBe(1);
  });
});

describe("dashboardFigures (AI-102)", () => {
  it("GivenStageMoves_WhenFiguresAreBuilt_ThenEachWeekCountsTicketsByTheirStageAtItsEnd", () => {
    const moved = ticket(1, { stage: "done", updatedAt: WEEK2 });
    const still = ticket(2, { stage: "in_progress" });
    const later = ticket(3, { createdAt: WEEK2, updatedAt: WEEK2 });
    const figures = dashboardFigures(
      WINDOW,
      data({
        tickets: [moved, still, later],
        ticketEvents: new Map([
          ["t1", [move("t1", "backlog", "ready", WEEK1), move("t1", "ready", "done", WEEK2)]],
          ["t3", []],
        ]),
      }),
    );

    const [first, second] = figures.weeks;
    expect(first).toMatchObject({
      start: "2026-11-02T00:00:00.000Z",
      end: "2026-11-09T00:00:00.000Z",
      ticketsByStage: { ready: 1, in_progress: 1, done: 0, backlog: 0 },
    });
    expect(second).toMatchObject({
      end: NOW.toISOString(),
      ticketsByStage: { ready: 0, in_progress: 1, done: 1, backlog: 1 },
    });
  });

  it("GivenTicketsDoneInAWeek_WhenFiguresAreBuilt_ThenLeadTimeHasMedianAndP90", () => {
    const hoursBefore = (h: number) => new Date(Date.parse(WEEK2) - h * 3_600_000).toISOString();
    const ids = [1, 2, 3, 4];
    const leads = [10, 20, 30, 100];
    const events = new Map(
      ids.map((n, i) => [
        `t${n}`,
        [
          move(`t${n}`, "backlog", "ready", hoursBefore(leads[i]!)),
          move(`t${n}`, "ready", "in_progress", hoursBefore(1)),
          move(`t${n}`, "in_progress", "done", WEEK2),
        ],
      ]),
    );
    const figures = dashboardFigures(
      WINDOW,
      data({ tickets: ids.map((n) => ticket(n, { updatedAt: WEEK2 })), ticketEvents: events }),
    );

    expect(figures.weeks[1]!.leadTimeHours).toEqual({ median: 20, p90: 100, count: 4 });
    expect(figures.weeks[0]!.leadTimeHours).toEqual({ median: null, p90: null, count: 0 });
  });

  it("GivenATicketThatSkippedReady_WhenItIsDone_ThenLeadTimeStartsAtInProgress", () => {
    const figures = dashboardFigures(
      WINDOW,
      data({
        tickets: [ticket(1, { updatedAt: WEEK2 })],
        ticketEvents: new Map([
          [
            "t1",
            [
              move("t1", "backlog", "in_progress", "2026-11-10T10:00:00.000Z"),
              move("t1", "in_progress", "done", WEEK2),
            ],
          ],
        ]),
      }),
    );

    expect(figures.weeks[1]!.leadTimeHours).toEqual({ median: 2, p90: 2, count: 1 });
  });

  it("GivenAMoveBackFromReview_WhenFiguresAreBuilt_ThenItCountsAsReworkInItsWeek", () => {
    const figures = dashboardFigures(
      WINDOW,
      data({
        tickets: [ticket(1, { stage: "in_progress", updatedAt: WEEK2 })],
        ticketEvents: new Map([
          [
            "t1",
            [
              move("t1", "in_progress", "ready_for_review", WEEK1),
              move("t1", "ready_for_review", "in_progress", WEEK2),
            ],
          ],
        ]),
      }),
    );

    expect(figures.weeks.map((w) => w.reworks)).toEqual([0, 1]);
  });

  it("GivenBuildRunsWithMetrics_WhenFiguresAreBuilt_ThenCiGreenRateAndReviewBlockersAreCounted", () => {
    const figures = dashboardFigures(
      WINDOW,
      data({
        endedRuns: [
          run("r1", { metrics: metrics({ ciGreenFirstTry: true, reviewBlockers: 0 }) }),
          run("r2", { metrics: metrics({ ciGreenFirstTry: false, reviewBlockers: 2 }) }),
          run("r3", { metrics: metrics({ ciGreenFirstTry: true, reviewBlockers: 1 }) }),
          run("r4", { metrics: metrics({}) }),
        ],
      }),
    );

    expect(figures.weeks[0]).toMatchObject({
      ciGreenFirstTry: { green: 2, known: 3, rate: 0.667 },
      reviewBlockers: 3,
    });
    expect(figures.weeks[1]!.ciGreenFirstTry).toEqual({ green: 0, known: 0, rate: null });
  });

  it("GivenRunsOfSeveralStepsAndSizes_WhenFiguresAreBuilt_ThenCostIsGroupedByStepAndSize", () => {
    const figures = dashboardFigures(
      WINDOW,
      data({
        tickets: [ticket(1, { size: "M" }), ticket(2, { size: null })],
        endedRuns: [
          run("r1", { step: "build", costUsd: 2, quotaDelta: { "5h": 1.5, weekly: null } }),
          run("r2", { step: "refine", ticketId: "t2", costUsd: 0.5 }),
          run("r3", { step: "review", ticketId: null, costUsd: 0.25 }),
        ],
      }),
    );

    const week = figures.weeks[0]!;
    expect(week.cost).toEqual({
      runs: 3,
      unknownCostRuns: 0,
      estimatedCostUsd: 2.75,
      tokensIn: 345,
      tokensOut: 150,
      turns: 21,
      quotaDelta: { "5h": 1.5, weekly: null },
    });
    const step = (s: string) => week.byStep.find((b) => b.step === s)!;
    expect(step("build")).toMatchObject({ runs: 1, estimatedCostUsd: 2, tokensIn: 115 });
    expect(step("refine")).toMatchObject({ runs: 1, estimatedCostUsd: 0.5 });
    expect(step("plan")).toMatchObject({ runs: 0, estimatedCostUsd: 0 });
    const size = (s: string) => week.bySize.find((b) => b.size === s)!;
    expect(size("M")).toMatchObject({ runs: 1, estimatedCostUsd: 2 });
    expect(size("unsized")).toMatchObject({ runs: 2, estimatedCostUsd: 0.75 });
    expect(week.bySize.map((b) => b.size)).toEqual(["S", "M", "L", "unsized"]);
  });

  it("GivenARunWithNoUsage_WhenFiguresAreBuilt_ThenItCountsAsUnknownCostNotZero", () => {
    const figures = dashboardFigures(
      WINDOW,
      data({
        endedRuns: [
          run("r1", { costUsd: 1 }),
          run("r2", { usage: null, costUsd: 3 }),
          run("r3", { usage: null, costUsd: null }),
        ],
      }),
    );

    expect(figures.weeks[0]!.cost).toMatchObject({
      runs: 3,
      unknownCostRuns: 2,
      estimatedCostUsd: 1,
      tokensIn: 115,
    });
    expect(figures.expensiveRuns.map((r) => r.id)).toEqual(["r1"]);
  });

  it("GivenActiveOrOutOfWindowRuns_WhenFiguresAreBuilt_ThenTheyAreNotCounted", () => {
    const figures = dashboardFigures(
      WINDOW,
      data({
        endedRuns: [run("r1", { status: "running" }), run("r2", { endedAt: BEFORE })],
      }),
    );

    expect(figures.weeks.map((w) => w.cost.runs)).toEqual([0, 0]);
  });

  it("GivenSixPricedRuns_WhenFiguresAreBuilt_ThenTheFiveCostliestAreListedWithTheirTicketKey", () => {
    const figures = dashboardFigures(
      WINDOW,
      data({
        tickets: [ticket(1)],
        endedRuns: [1, 6, 3, 2, 5, 4].map((usd) =>
          run(`r${usd}`, { costUsd: usd, endedAt: usd > 3 ? WEEK2 : WEEK1 }),
        ),
      }),
    );

    expect(figures.expensiveRuns.map((r) => r.id)).toEqual(["r6", "r5", "r4", "r3", "r2"]);
    expect(figures.expensiveRuns[0]).toMatchObject({
      projectId: "ai",
      ticketKey: "AI-1",
      step: "build",
      costUsd: 6,
      costIsEstimate: false,
      endedAt: WEEK2,
    });
  });
});

class CappedRunStore extends InMemoryRunStore {
  override async listEndedBetween(projectId: string, from: string, to: string, limit: number) {
    return { ...(await super.listEndedBetween(projectId, from, to, limit)), complete: false };
  }
}

async function seed(tracker: InMemoryWorkTracker, runs: InMemoryRunStore, key: string) {
  const project = await tracker.createProject({ name: key, key });
  const t = await tracker.createTicket(project.id, { type: "feature", title: "x" }, "andy");
  await tracker.updateTicket(
    project.id,
    t.id,
    { stage: { to: "ready", forced: false, reason: null } },
    "andy",
  );
  const r = await runs.create({
    projectId: project.id,
    ticketId: t.id,
    step: "build",
    route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
    tier: null,
  });
  await runs.update(
    r.id,
    { status: "succeeded", endedAt: new Date().toISOString(), costUsd: 2, usage: USAGE },
    ["queued"],
  );
  return project;
}

describe("DashboardReader (AI-102)", () => {
  const window = () => dashboardWindow(new Date(Date.now() + 1000), 2);

  it("GivenAProject_WhenItsDashboardIsRead_ThenStoredTicketsAndRunsAreCounted", async () => {
    const tracker = new InMemoryWorkTracker();
    const runs = new InMemoryRunStore();
    await seed(tracker, runs, "AI");

    const dash = await new DashboardReader(tracker, runs).project("ai", window());

    expect(dash).toMatchObject({ projectId: "ai", key: "AI", partial: [] });
    const now = dash.weeks.at(-1)!;
    expect(now.ticketsByStage.ready).toBe(1);
    expect(now.cost).toMatchObject({ runs: 1, estimatedCostUsd: 2 });
  });

  it("GivenAnUnknownProject_WhenItsDashboardIsRead_ThenNotFound", async () => {
    const reader = new DashboardReader(new InMemoryWorkTracker(), new InMemoryRunStore());

    await expect(reader.project("nope", window())).rejects.toMatchObject({ code: "not_found" });
  });

  it("GivenTheRunCapIsReached_WhenTheDashboardIsRead_ThenRunFiguresAreMarkedPartial", async () => {
    const tracker = new InMemoryWorkTracker();
    const runs = new CappedRunStore();
    await seed(tracker, runs, "AI");

    const dash = await new DashboardReader(tracker, runs).project("ai", window());

    expect(dash.partial).toEqual(["ciGreenFirstTry", "reviewBlockers", "cost", "expensiveRuns"]);
  });

  it("GivenMoreChangedTicketsThanTheCap_WhenTheDashboardIsRead_ThenTicketFiguresAreMarkedPartial", async () => {
    const tracker = new InMemoryWorkTracker();
    const project = await tracker.createProject({ name: "AI", key: "AI" });
    for (let i = 0; i <= MAX_DASHBOARD_TICKET_READS; i++) {
      await tracker.createTicket(project.id, { title: `t${i}` }, "andy");
    }

    const dash = await new DashboardReader(tracker, new InMemoryRunStore()).project("ai", window());

    expect(dash.partial).toEqual(["ticketsByStage", "leadTime", "reworks"]);
  });

  it("GivenTwoProjects_WhenAllIsRead_ThenFiguresAreSummedAndListedPerProject", async () => {
    const tracker = new InMemoryWorkTracker();
    const runs = new InMemoryRunStore();
    await seed(tracker, runs, "BB");
    await seed(tracker, runs, "AI");

    const dash = await new DashboardReader(tracker, runs).all(window());

    expect(dash.projects.map((p) => p.key)).toEqual(["AI", "BB"]);
    expect(dash.projects[0]!.weeks.at(-1)!.cost.estimatedCostUsd).toBe(2);
    const now = dash.weeks.at(-1)!;
    expect(now.cost).toMatchObject({ runs: 2, estimatedCostUsd: 4 });
    expect(now.ticketsByStage.ready).toBe(2);
    expect(dash.expensiveRuns).toHaveLength(2);
    expect(dash.partial).toEqual([]);
  });

  it("GivenMoreProjectsThanTheCap_WhenAllIsRead_ThenProjectsAreMarkedPartial", async () => {
    const tracker = new InMemoryWorkTracker();
    for (let i = 0; i <= MAX_DASHBOARD_PROJECTS; i++) {
      await tracker.createProject({ name: `P${i}`, key: `P${String(i).padStart(2, "0")}` });
    }

    const dash = await new DashboardReader(tracker, new InMemoryRunStore()).all(window());

    expect(dash.projects).toHaveLength(MAX_DASHBOARD_PROJECTS);
    expect(dash.partial).toEqual(["projects"]);
  });

  it("GivenOneProjectHitsTheRunCap_WhenAllIsRead_ThenTheTotalIsMarkedPartialToo", async () => {
    const tracker = new InMemoryWorkTracker();
    const runs = new CappedRunStore();
    await seed(tracker, runs, "AI");

    const dash = await new DashboardReader(tracker, runs).all(window());

    expect(dash.partial).toContain("cost");
    expect(dash.projects[0]!.partial).toContain("cost");
  });
});
