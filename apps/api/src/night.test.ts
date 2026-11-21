import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryCodeHostConnectionStore,
  InMemoryNightLaunchStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type NewTicket,
  type NightLaunch,
} from "@andy/contracts";
import { NightLaunches, RunService } from "@andy/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { launchNight, progressOf, stopNight, type NightDeps, type NightStatus } from "./night";

/** M4.17: Night launch step: the checklist, launch and stop over REST (ADR-0049). */

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "uid-1", email: "andy@example.com", emailVerified: true };
  },
};

const route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;
const story = (title: string, extra: Partial<NewTicket> = {}): NewTicket => ({
  type: "feature",
  title,
  body: "A story.",
  acceptanceCriteria: ["When Andy opens it, the system shall show it."],
  size: "S",
  sizeReason: "small",
  ...extra,
});
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const BUDGET = { maxRuns: 10, maxTokens: 1_000_000, maxUsd: 20 };

const REPO = "albernhagen/andy-intelligence";

/** `github`: the App is connected and installed on the project's repo (AI-122: epic branch). */
async function setup(opts: { github?: boolean; connected?: boolean } = {}) {
  const tracker = new InMemoryWorkTracker();
  const runs = new InMemoryRunStore();
  const store = new InMemoryNightLaunchStore();
  const host = new InMemoryCodeHost([
    { fullName: REPO, defaultBranch: "main", private: false, url: `https://github.com/${REPO}` },
  ]);
  const connections = new InMemoryCodeHostConnectionStore();
  if (opts.github && opts.connected !== false) {
    await connections.save({
      appId: "1",
      slug: "andy-intelligence",
      clientId: "Iv1",
      owner: "albernhagen",
      privateKey: "PEM",
      webhookSecret: "secret",
      connectedAt: "2026-11-03T00:00:00.000Z",
    });
  }
  await tracker.createProject({ name: "AI", key: "AI", repos: opts.github ? [REPO] : [] });
  const epic = await tracker.createTicket("ai", { title: "Night", type: "epic" }, "andy");
  const ready = async (title: string, extra: Partial<NewTicket> = {}) => {
    const t = await tracker.createTicket(
      "ai",
      story(title, { parentId: epic.id, ...extra }),
      "andy",
    );
    return tracker.updateTicket(
      "ai",
      t.id,
      { stage: { to: "ready", forced: true, reason: null } },
      "andy",
    );
  };
  const app = createApp({
    verifier,
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs,
    nightLaunches: store,
    ...(opts.github
      ? {
          github: {
            publicUrl: "https://cp.example",
            connections,
            events: new InMemoryCodeEventLog(),
            codeHostFor: () => host,
          },
        }
      : {}),
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : text) as never };
  };
  const path = `/api/projects/ai/tickets/${epic.id}/night`;
  const deps = (): NightDeps => {
    const service = new RunService(tracker, runs, null);
    return {
      nights: new NightLaunches(store, tracker, service),
      store,
      tracker,
      runs,
      plans: service,
    };
  };
  return { tracker, runs, store, epic, ready, call, path, deps, host };
}

describe("night launch API", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenStoriesWithOpenQuestionsAndPlans_WhenTheChecklistIsRead_ThenEachIsListedWithItsLinks", async () => {
    const { tracker, runs, ready, call, path } = await setup();
    const asking = await ready("Asking");
    const question = await tracker.askQuestion("ai", asking.id, { text: "Which lane?" }, "andy");
    const big = await ready("Big", { size: "M", sizeReason: "two screens" });
    const plan = await runs.create({
      projectId: "ai",
      ticketId: big.id,
      step: "plan",
      route,
      tier: null,
    });

    const { status, json } = await call("GET", path);
    const night = json as NightStatus;

    expect(status).toBe(200);
    expect(night.stories).toEqual([
      expect.objectContaining({
        key: asking.key,
        questions: [{ id: question.id, text: "Which lane?" }],
      }),
      expect.objectContaining({ key: big.key, plan: { kind: "planning", runId: plan.id } }),
    ]);
    expect(night.problems.map((p) => [p.kind, p.ticketKey])).toEqual([
      ["open_questions", asking.key],
      ["plan_not_approved", big.key],
    ]);
    expect(night.launch).toBeNull();
  });

  it("GivenAnOpenQuestion_WhenLaunched_ThenRefusedWithEveryProblemByKeyAndNothingStored", async () => {
    const { tracker, store, ready, call, path } = await setup();
    const asking = await ready("Asking");
    await tracker.askQuestion("ai", asking.id, { text: "Which lane?" }, "andy");

    const { status, json } = await call("POST", path, { budget: BUDGET, stopAt: inHours(4) });

    expect(status).toBe(422);
    expect((json as { details: string[] }).details).toEqual([`${asking.key}: 1 open question`]);
    expect(await store.listForProject("ai")).toEqual([]);
  });

  it("GivenNothingOpen_WhenLaunched_ThenARunningLaunchIsStoredAndTheStatusShowsProgressAndSpend", async () => {
    const { runs, ready, call, path } = await setup();
    const first = await ready("First");
    await ready("Second");

    const launched = await call("POST", path, { budget: BUDGET, stopAt: inHours(4) });
    const run = await runs.create({
      projectId: "ai",
      ticketId: first.id,
      step: "build",
      route,
      tier: null,
    });
    await runs.update(run.id, { status: "running" }, ["queued"]);
    const { json } = await call("GET", path);
    const night = json as NightStatus;

    expect(launched.status).toBe(200);
    expect(launched.json).toMatchObject({ status: "running", budget: BUDGET });
    expect(night.launch).toMatchObject({ status: "running" });
    expect(night.progress).toEqual({
      stories: { total: 2, done: 0, running: 1, stopped: 0, skipped: 0, waiting: 1 },
      nightAssumptions: 0,
      spend: { runs: 1, tokens: 0, estimatedUsd: 0, unknownRuns: 0 },
    });
  });

  it("GivenAMissingBudgetAndStopTime_WhenLaunched_ThenEachIsAProblem", async () => {
    const { ready, call, path } = await setup();
    await ready("First");

    const { status, json } = await call("POST", path, { budget: {} });

    expect(status).toBe(422);
    expect((json as { details: string[] }).details).toEqual([
      "budget: max agent tasks is missing",
      "budget: max tokens is missing",
      "budget: max USD is missing",
      "stop time is missing",
    ]);
  });

  it("GivenAnAgentTaskInFlight_WhenStopped_ThenStoppingUntilItFinishesThenEndedAndTheProjectFree", async () => {
    const { runs, ready, call, path } = await setup();
    const first = await ready("First");
    await call("POST", path, { budget: BUDGET, stopAt: inHours(4) });
    const run = await runs.create({
      projectId: "ai",
      ticketId: first.id,
      step: "build",
      route,
      tier: null,
    });
    await runs.update(run.id, { status: "running" }, ["queued"]);

    const stopped = await call("POST", `${path}/stop`);
    const again = await call("POST", `${path}/stop`);
    const whileRunning = (await call("GET", path)).json as NightStatus;
    await runs.update(run.id, { status: "succeeded" }, ["running"]);
    const after = (await call("GET", path)).json as NightStatus;
    const relaunch = await call("POST", path, { budget: BUDGET, stopAt: inHours(4) });

    expect(stopped.status).toBe(200);
    expect(stopped.json).toMatchObject({ status: "stopping" });
    expect(again.status).toBe(409);
    expect(whileRunning.launch).toMatchObject({ status: "stopping" });
    expect(after.launch).toMatchObject({ status: "ended", endReason: "stopped" });
    expect(after.problems).toEqual([]);
    expect(relaunch.json).toMatchObject({ status: "running" });
  });

  it("GivenGitHubConnected_WhenLaunchedThenStopped_ThenTheEpicBranchIsOpenedAtMainsTipAndTheLaunchEnds", async () => {
    const { ready, call, path, host, epic } = await setup({ github: true });
    await ready("First");

    const launched = await call("POST", path, { budget: BUDGET, stopAt: inHours(4) });
    const stopped = await call("POST", `${path}/stop`);

    const branch = { name: `epic/${epic.key}`, sha: InMemoryCodeHost.DEFAULT_TIP };
    expect(launched.status).toBe(200);
    expect(launched.json).toMatchObject({ status: "running", epicBranch: branch });
    expect(await host.branchSha(REPO, branch.name)).toBe(branch.sha);
    expect(stopped.json).toMatchObject({
      status: "ended",
      endReason: "stopped",
      epicBranch: branch,
    });
  });

  it("GivenGitHubSetUpButNotConnected_WhenLaunched_ThenItLaunchesWithoutAnEpicBranch", async () => {
    const { ready, call, path } = await setup({ github: true, connected: false });
    await ready("First");

    const launched = await call("POST", path, { budget: BUDGET, stopAt: inHours(4) });

    expect(launched.status).toBe(200);
    expect(launched.json).toMatchObject({ status: "running", epicBranch: null });
  });

  it("GivenNoGitHub_WhenLaunched_ThenNoEpicBranchAndStoriesBuildOnTheDefaultBranch", async () => {
    const { ready, call, path } = await setup();
    await ready("First");

    const launched = await call("POST", path, { budget: BUDGET, stopAt: inHours(4) });

    expect(launched.json).toMatchObject({ status: "running", epicBranch: null });
  });

  it("GivenNothingInFlight_WhenStopped_ThenTheLaunchEndsAtOnce", async () => {
    const { ready, call, path } = await setup();
    await ready("First");
    await call("POST", path, { budget: BUDGET, stopAt: inHours(4) });

    const stopped = await call("POST", `${path}/stop`);

    expect(stopped.json).toMatchObject({ status: "ended", endReason: "stopped" });
  });

  it("GivenALaunchPastItsStopTime_WhenTheStatusIsRead_ThenItEndsAndANewLaunchIsAllowed", async () => {
    const { ready, call, path } = await setup();
    await ready("First");
    await call("POST", path, { budget: BUDGET, stopAt: inHours(1) });

    vi.useFakeTimers({ now: Date.now() + 2 * 3_600_000, toFake: ["Date"] });
    try {
      const { json } = await call("GET", path);
      expect((json as NightStatus).launch).toMatchObject({
        status: "ended",
        endReason: "stop_time",
      });
      expect((json as NightStatus).problems).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("GivenNoLaunch_WhenStopped_ThenAConflict", async () => {
    const { call, path } = await setup();
    expect((await call("POST", `${path}/stop`)).status).toBe(409);
  });

  it("GivenAnUnknownEpic_WhenRead_ThenNotFound", async () => {
    const { call } = await setup();
    const missing = "/api/projects/ai/tickets/00000000-0000-4000-8000-000000000000/night";
    expect((await call("GET", missing)).status).toBe(404);
  });

  it("GivenACallerWhoIsNotAndy_WhenLaunchingOrStopping_ThenRefused", async () => {
    const { ready, epic, call, path, deps } = await setup();
    await ready("First");
    const body = { budget: BUDGET, stopAt: inHours(4) };

    await expect(launchNight(deps(), epic, body, "agent:run-1")).rejects.toMatchObject({
      code: "forbidden",
    });
    await call("POST", path, body);
    await expect(stopNight(deps(), epic, "agent:run-1")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("progressOf", () => {
  it("GivenStoriesAndAgentTasks_WhenRead_ThenCountsAndSpendSinceTheStartOnly", async () => {
    const tracker = new InMemoryWorkTracker();
    const runs = new InMemoryRunStore();
    await tracker.createProject({ name: "AI", key: "AI" });
    const make = (title: string) => tracker.createTicket("ai", story(title), "andy");
    const [done, flagged, waiting] = [
      await make("Done"),
      await make("Flagged"),
      await make("Wait"),
    ];
    await tracker.updateTicket(
      "ai",
      done.id,
      { stage: { to: "done", forced: true, reason: null } },
      "andy",
    );
    await tracker.updateTicket("ai", flagged.id, { fields: { needsAttention: true } }, "andy");
    const before = await runs.create({
      projectId: "ai",
      ticketId: done.id,
      step: "build",
      route,
      tier: null,
    });
    await runs.update(before.id, { status: "succeeded", costUsd: 9 }, ["queued"]);
    const startedAt = new Date(Date.now() + 1000).toISOString();
    vi.useFakeTimers({ now: Date.parse(startedAt) + 1000, toFake: ["Date"] });
    try {
      const priced = await runs.create({
        projectId: "ai",
        ticketId: done.id,
        step: "build",
        route,
        tier: null,
      });
      await runs.update(
        priced.id,
        { status: "succeeded", costUsd: 1.234, tokensIn: 100, tokensOut: 20 },
        ["queued"],
      );
      const unknown = await runs.create({
        projectId: "ai",
        ticketId: flagged.id,
        step: "build",
        route,
        tier: null,
      });
      await runs.update(unknown.id, { status: "failed" }, ["queued"]);
    } finally {
      vi.useRealTimers();
    }
    const launch = {
      projectId: "ai",
      storyKeys: [done.key, flagged.key, waiting.key, "AI-99"],
      startedAt,
      createdAt: startedAt,
      stoppedStories: [],
    } as unknown as NightLaunch;

    expect(await progressOf({ tracker, runs }, launch)).toEqual({
      stories: { total: 4, done: 1, running: 0, stopped: 1, skipped: 0, waiting: 2 },
      nightAssumptions: 0,
      spend: { runs: 2, tokens: 120, estimatedUsd: 1.23, unknownRuns: 1 },
    });
  });

  it("GivenAStoryStoppedForTheNightAndNightAssumptions_WhenRead_ThenStoppedSkippedAndAssumptionsAreCounted", async () => {
    const tracker = new InMemoryWorkTracker();
    const runs = new InMemoryRunStore();
    await tracker.createProject({ name: "AI", key: "AI" });
    const make = (title: string) => tracker.createTicket("ai", story(title), "andy");
    const [failed, dependant, assumed] = [await make("Failed"), await make("Dep"), await make("A")];
    const at = new Date().toISOString();
    const assumption = (id: string, nightLaunchId: string | null) => ({
      id,
      text: "Use the existing table.",
      question: "Which table?",
      options: [],
      cost: "scope" as const,
      confidence: "sure" as const,
      demotedBy: null,
      nightLaunchId,
      runId: "r1",
      status: "assumed" as const,
      questionId: null,
      answeredAt: null,
      settledBy: null,
      createdAt: at,
      context: null,
      choices: [],
      recommendation: null,
    });
    await tracker.updateTicket(
      "ai",
      assumed.id,
      {
        fields: {
          refineAssumptions: [
            assumption("r1-a1", "night-1"),
            assumption("r1-a2", "night-1"),
            assumption("r1-a3", null),
            assumption("r1-a4", "night-0"),
          ],
        },
      },
      "andy",
    );
    const launch = {
      id: "night-1",
      projectId: "ai",
      storyKeys: [failed.key, dependant.key, assumed.key],
      startedAt: at,
      createdAt: at,
      stoppedStories: [{ key: failed.key, reason: "build failed", at, skipped: [dependant.key] }],
    } as unknown as NightLaunch;

    expect(await progressOf({ tracker, runs }, launch)).toMatchObject({
      stories: { total: 3, done: 0, running: 0, stopped: 1, skipped: 1, waiting: 1 },
      nightAssumptions: 2,
    });
  });
});
