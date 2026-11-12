import {
  InMemoryNightLaunchStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  NightLaunch,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NightLaunches } from "./night-launch";
import { settleNight } from "./night-end";

const route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;
const NOW = new Date("2026-11-12T22:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

/** M4.17: a launch ends on its own when stopped with nothing in flight, or past its stop time. */
describe("settleNight", () => {
  let tracker: InMemoryWorkTracker;
  let runs: InMemoryRunStore;
  let store: InMemoryNightLaunchStore;
  let now: Date;
  let storyId: string;
  const deps = () => ({
    nights: new NightLaunches(
      store,
      tracker,
      { planStateOf: async () => ({ kind: "none" }) },
      () => now,
    ),
    store,
    tracker,
    runs,
    now: () => now,
  });
  const launch = (overrides: Partial<NightLaunch> = {}) =>
    store.create(
      NightLaunch.parse({
        id: "launch-1",
        projectId: "ai",
        epicId: "epic-1",
        epicKey: "AI-1",
        budget: { maxRuns: 10, maxTokens: 1_000_000, maxUsd: 20 },
        stopAt: at(240),
        status: "running",
        storyKeys: ["AI-2"],
        createdAt: at(0),
        createdBy: "user:uid-1",
        startedAt: at(0),
        ...overrides,
      }),
    );
  const inFlight = async () => {
    const run = await runs.create({
      projectId: "ai",
      ticketId: storyId,
      step: "build",
      route,
      tier: null,
    });
    return runs.update(run.id, { status: "running" }, ["queued"]);
  };

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    now = NOW;
    tracker = new InMemoryWorkTracker();
    runs = new InMemoryRunStore();
    store = new InMemoryNightLaunchStore();
    await tracker.createProject({ name: "AI", key: "AI" });
    await tracker.createTicket("ai", { title: "Epic", type: "epic" }, "andy");
    storyId = (await tracker.createTicket("ai", { title: "Story" }, "andy")).id;
  });

  it("GivenNoActiveLaunch_WhenSettled_ThenNull", async () => {
    expect(await settleNight(deps(), "ai")).toBeNull();
  });

  it("GivenARunningLaunchBeforeItsStopTime_WhenSettled_ThenItKeepsRunning", async () => {
    await launch();
    expect(await settleNight(deps(), "ai")).toMatchObject({ status: "running" });
  });

  it("GivenALaunchPastItsStopTime_WhenSettled_ThenItEndsAsStopTime", async () => {
    await launch();
    now = new Date(Date.parse(at(241)));
    expect(await settleNight(deps(), "ai")).toBeNull();
    expect(await store.get("launch-1")).toMatchObject({ status: "ended", endReason: "stop_time" });
  });

  it("GivenAStoppingLaunchWithAStoryInFlight_WhenSettled_ThenItWaitsThenEndsOnceItFinishes", async () => {
    await launch({ status: "stopping" });
    const run = await inFlight();
    expect(await settleNight(deps(), "ai")).toMatchObject({ status: "stopping" });

    await runs.update(run.id, { status: "succeeded" }, ["running"]);
    expect(await settleNight(deps(), "ai")).toBeNull();
    expect(await store.get("launch-1")).toMatchObject({ status: "ended", endReason: "stopped" });
  });

  it("GivenACallerReason_WhenSettled_ThenItEndsWithThatReason", async () => {
    await launch();
    await inFlight();
    expect(await settleNight(deps(), "ai", "max_usd")).toBeNull();
    expect(await store.get("launch-1")).toMatchObject({ status: "ended", endReason: "max_usd" });
  });

  it("GivenAnotherEndWinsTheRace_WhenSettled_ThenNoError", async () => {
    await launch({ status: "stopping" });
    const racing = deps();
    const end = racing.nights.end.bind(racing.nights);
    racing.nights.end = async (id, reason) => {
      await end(id, reason);
      return end(id, reason);
    };
    await expect(settleNight(racing, "ai")).resolves.toBeNull();
  });
});
