import {
  InMemoryNightLaunchStore,
  InMemoryWorkTracker,
  NIGHT_LIMITS,
  type NewTicket,
  type Stage,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NightLaunches,
  launchProblems,
  type LaunchChild,
  type LaunchRequest,
} from "./night-launch";
import type { PlanState } from "./plans";

const NOW = new Date("2026-11-12T22:00:00.000Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const BUDGET = { maxRuns: 20, maxTokens: 5_000_000, maxUsd: 50 };
const EPIC = { key: "AI-84", type: "epic" as const };

const child = (
  key: string,
  overrides: Partial<LaunchChild["ticket"]> = {},
  extra: Partial<Omit<LaunchChild, "ticket">> = {},
): LaunchChild => ({
  ticket: { key, stage: "ready", size: "M", archived: false, ...overrides },
  openQuestions: 0,
  plan: "approved",
  ...extra,
});
const request = (overrides: Partial<LaunchRequest> = {}): LaunchRequest => ({
  budget: BUDGET,
  stopAt: inHours(8),
  now: NOW,
  active: null,
  ...overrides,
});
const kinds = (problems: { kind: string }[]) => problems.map((p) => p.kind);

describe("launchProblems", () => {
  it("GivenReadyStoriesApprovedPlansABudgetAndAStopTime_WhenChecked_ThenNoProblems", () => {
    const children = [child("AI-85"), child("AI-86", { size: "S" }, { plan: "none" })];
    expect(launchProblems(EPIC, children, request())).toEqual([]);
  });

  it("GivenOpenItemsOnChildren_WhenChecked_ThenEachProblemIsListedByTicketKey", () => {
    const children = [
      child("AI-85", {}, { openQuestions: 2 }),
      child("AI-86", { stage: "backlog" }),
      child("AI-87", { size: "L" }, { plan: "awaiting" }),
      child("AI-88", {}, { openQuestions: 1, plan: "none" }),
    ];

    expect(launchProblems(EPIC, children, request())).toEqual([
      { kind: "open_questions", ticketKey: "AI-85", message: "AI-85: 2 open questions" },
      { kind: "not_ready", ticketKey: "AI-86", message: "AI-86: in Backlog, not Ready" },
      {
        kind: "plan_not_approved",
        ticketKey: "AI-87",
        message: "AI-87: size L, plan awaiting approval",
      },
      { kind: "open_questions", ticketKey: "AI-88", message: "AI-88: 1 open question" },
      { kind: "plan_not_approved", ticketKey: "AI-88", message: "AI-88: size M, no plan" },
    ]);
  });

  it("GivenAnUnsizedChildWithoutAnApprovedPlan_WhenChecked_ThenItNeedsAPlan", () => {
    const problems = launchProblems(
      EPIC,
      [child("AI-85", { size: null }, { plan: "stale" })],
      request(),
    );
    expect(problems).toEqual([
      { kind: "plan_not_approved", ticketKey: "AI-85", message: "AI-85: size unsized, plan stale" },
    ]);
  });

  it("GivenDoneCancelledAndArchivedChildren_WhenChecked_ThenTheyAreNotCoveredOrChecked", () => {
    const finished = [
      child("AI-85", { stage: "done" }, { plan: "none" }),
      child("AI-86", { stage: "cancelled" }, { openQuestions: 1 }),
      child("AI-87", { archived: true, stage: "backlog" }),
    ];
    expect(launchProblems(EPIC, [...finished, child("AI-88")], request())).toEqual([]);
    expect(launchProblems(EPIC, finished, request())).toEqual([
      { kind: "no_stories", ticketKey: "AI-84", message: "AI-84 has no open stories" },
    ]);
  });

  it("GivenANonEpicOrTooManyStories_WhenChecked_ThenBothAreProblems", () => {
    expect(
      kinds(launchProblems({ key: "AI-9", type: "feature" }, [child("AI-85")], request())),
    ).toEqual(["not_epic"]);
    const many = Array.from({ length: NIGHT_LIMITS.maxStories + 1 }, (_, i) =>
      child(`AI-${200 + i}`, { stage: "backlog" }, { openQuestions: 1, plan: "none" }),
    );
    expect(kinds(launchProblems(EPIC, many, request()))).toEqual(["too_many_stories"]);
  });

  it("GivenBudgetFieldsMissingNotPositiveOrOverTheCap_WhenChecked_ThenEachIsAProblem", () => {
    expect(
      launchProblems(EPIC, [child("AI-85")], request({ budget: {} })).map((p) => p.message),
    ).toEqual([
      "budget: max agent tasks is missing",
      "budget: max tokens is missing",
      "budget: max USD is missing",
    ]);
    const bad = request({ budget: { maxRuns: 0, maxTokens: -5, maxUsd: Number.NaN } });
    expect(kinds(launchProblems(EPIC, [child("AI-85")], bad))).toEqual([
      "budget_not_positive",
      "budget_not_positive",
      "budget_not_positive",
    ]);
    const fractional = request({ budget: { ...BUDGET, maxRuns: 2.5, maxUsd: 0.5 } });
    expect(launchProblems(EPIC, [child("AI-85")], fractional)).toEqual([
      {
        kind: "budget_not_positive",
        ticketKey: null,
        message: "budget: max agent tasks must be a positive whole number",
      },
    ]);
    const over = request({ budget: { ...BUDGET, maxUsd: NIGHT_LIMITS.maxUsd + 1 } });
    expect(kinds(launchProblems(EPIC, [child("AI-85")], over))).toEqual(["budget_over_cap"]);
  });

  it("GivenAStopTimeMissingPastOrMoreThan16HoursAway_WhenChecked_ThenItIsAProblem", () => {
    const check = (stopAt: string | null) =>
      kinds(launchProblems(EPIC, [child("AI-85")], request({ stopAt })));
    expect(check(null)).toEqual(["stop_time_missing"]);
    expect(check(NOW.toISOString())).toEqual(["stop_time_past"]);
    expect(check(inHours(-1))).toEqual(["stop_time_past"]);
    expect(check(inHours(16))).toEqual([]);
    expect(check(inHours(16.01))).toEqual(["stop_time_too_far"]);
  });

  it("GivenAnotherLaunchRunningInTheProject_WhenChecked_ThenItBlocks", () => {
    const problems = launchProblems(
      EPIC,
      [child("AI-85")],
      request({ active: { epicKey: "AI-60", status: "stopping" } }),
    );
    expect(problems).toEqual([
      {
        kind: "launch_running",
        ticketKey: "AI-60",
        message: "a launch for AI-60 is stopping in this project",
      },
    ]);
  });
});

describe("NightLaunches", () => {
  let tracker: InMemoryWorkTracker;
  let store: InMemoryNightLaunchStore;
  let plans: Map<string, PlanState["kind"]>;
  let launches: NightLaunches;
  let epic: Ticket;
  let now: Date;

  const story = async (stage: Stage = "ready", extra: Partial<NewTicket> = {}) => {
    const t = await tracker.createTicket(
      "ai",
      { type: "feature", title: "Story", size: "M", parentId: epic.id, ...extra },
      "andy",
    );
    if (stage === "backlog") return t;
    return tracker.updateTicket(
      "ai",
      t.id,
      { stage: { to: stage, forced: true, reason: null } },
      "andy",
    );
  };
  const input = (overrides: object = {}) => ({
    epicId: epic.id,
    budget: BUDGET,
    stopAt: inHours(8),
    ...overrides,
  });

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    now = NOW;
    tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "AI", key: "AI" });
    await tracker.createProject({ name: "Other", key: "OT" });
    store = new InMemoryNightLaunchStore();
    plans = new Map();
    const planStates = {
      planStateOf: async (t: Ticket) => ({ kind: plans.get(t.id) ?? "approved" }) as PlanState,
    };
    let n = 0;
    launches = new NightLaunches(
      store,
      tracker,
      planStates,
      () => now,
      () => `launch-${++n}`,
    );
    epic = await tracker.createTicket("ai", { type: "epic", title: "Overnight" }, "andy");
  });

  it("GivenAnEpicWhoseStoriesAreAllClear_WhenStarted_ThenARunningLaunchIsStored", async () => {
    const a = await story();
    const b = await story("ready", { size: "S" });
    plans.set(b.id, "none");
    await story("done");

    const launch = await launches.start("ai", input(), "user:uid-1");

    expect(launch).toEqual({
      id: "launch-1",
      projectId: "ai",
      epicId: epic.id,
      epicKey: epic.key,
      budget: BUDGET,
      stopAt: inHours(8),
      status: "running",
      storyKeys: [a.key, b.key],
      createdAt: NOW.toISOString(),
      createdBy: "user:uid-1",
      startedAt: NOW.toISOString(),
      endedAt: null,
      endReason: null,
    });
    expect(await store.findActive("ai")).toEqual(launch);
  });

  it("GivenStoriesWithOpenItems_WhenStarted_ThenRefusedWithEachProblemByKeyAndNothingStored", async () => {
    const asked = await story();
    await tracker.askQuestion("ai", asked.id, { text: "Which colour?" }, "andy");
    const backlog = await story("backlog");
    const unplanned = await story("ready", { size: "L" });
    plans.set(unplanned.id, "awaiting");

    const refused = launches.start("ai", input(), "andy");

    await expect(refused).rejects.toMatchObject({
      name: "DomainError",
      code: "not_buildable",
      details: [
        `${asked.key}: 1 open question`,
        `${backlog.key}: in Backlog, not Ready`,
        `${unplanned.key}: size L, plan awaiting approval`,
      ],
    });
    expect(await store.listForProject("ai")).toEqual([]);
  });

  it("GivenARunningLaunch_WhenAnotherIsStartedInTheProject_ThenRefusedButAnotherProjectMayLaunch", async () => {
    await story();
    await launches.start("ai", input(), "andy");
    const second = await tracker.createTicket("ai", { type: "epic", title: "Second" }, "andy");
    await story("ready", { parentId: second.id });

    await expect(launches.start("ai", input({ epicId: second.id }), "andy")).rejects.toMatchObject({
      code: "not_buildable",
      details: [`a launch for ${epic.key} is running in this project`],
    });
    const other = await tracker.createTicket("ot", { type: "epic", title: "Elsewhere" }, "andy");
    const otherStory = await tracker.createTicket(
      "ot",
      { type: "feature", title: "S", size: "S", parentId: other.id },
      "andy",
    );
    await tracker.updateTicket(
      "ot",
      otherStory.id,
      { stage: { to: "ready", forced: true, reason: null } },
      "andy",
    );
    expect((await launches.start("ot", input({ epicId: other.id }), "andy")).status).toBe(
      "running",
    );
  });

  it("GivenARaceThatPassedTheCheck_WhenTheStoreSeesAnActiveLaunch_ThenConflict", async () => {
    await story();
    vi.spyOn(store, "findActive").mockResolvedValue(null);
    await launches.start("ai", input(), "andy");
    await expect(launches.start("ai", input(), "andy")).rejects.toMatchObject({
      name: "WorkTrackerError",
      code: "conflict",
    });
  });

  it("GivenAnAgentOrAnUnknownEpic_WhenStarting_ThenForbiddenOrNotFound", async () => {
    await story();
    await expect(launches.start("ai", input(), "agent:run-1")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(launches.start("ai", input({ epicId: "nope" }), "andy")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("GivenMoreStoriesThanTheCap_WhenChecked_ThenNoPerStoryReadsAndOnlyTheCountIsAProblem", async () => {
    for (let i = 0; i <= NIGHT_LIMITS.maxStories; i++) await story();
    const questions = vi.spyOn(tracker, "listQuestions");
    let planReads = 0;
    launches = new NightLaunches(
      store,
      tracker,
      {
        planStateOf: async () => {
          planReads++;
          return { kind: "none" };
        },
      },
      () => now,
    );

    const result = await launches.check("ai", input());

    expect(kinds(result.problems)).toEqual(["too_many_stories"]);
    expect(questions).not.toHaveBeenCalled();
    expect(planReads).toBe(0);
  });

  it("GivenAnEpic_WhenChecked_ThenProblemsAndCoveredStoriesComeBackAndNothingIsStored", async () => {
    const a = await story();
    const result = await launches.check("ai", { epicId: epic.id });
    expect(result.storyKeys).toEqual([a.key]);
    expect(kinds(result.problems)).toEqual([
      "budget_missing",
      "budget_missing",
      "budget_missing",
      "stop_time_missing",
    ]);
    expect(await store.listForProject("ai")).toEqual([]);
  });

  it("GivenARunningLaunch_WhenStoppedThenEnded_ThenItIsStoppingThenEndedWithItsReason", async () => {
    await story();
    const launch = await launches.start("ai", input(), "andy");
    await expect(launches.stop(launch.id, "system")).rejects.toMatchObject({ code: "forbidden" });

    expect((await launches.stop(launch.id, "andy")).status).toBe("stopping");
    await expect(launches.stop(launch.id, "andy")).rejects.toMatchObject({ code: "conflict" });
    now = new Date(inHours(1));
    expect(await launches.end(launch.id, "stopped")).toMatchObject({
      status: "ended",
      endedAt: inHours(1),
      endReason: "stopped",
    });
    expect(await store.findActive("ai")).toBeNull();
    await expect(launches.stop("missing", "andy")).rejects.toMatchObject({ code: "not_found" });
  });
});
