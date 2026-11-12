import {
  InMemoryCodeHost,
  InMemoryNightLaunchStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  NightLaunch,
  type BaseBranch,
  type NewTicket,
  type Repo,
  type Run,
  type Runner,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EpicBranches, buildBaseBranch, type EpicBranchHost } from "./night-branch";
import { RunService } from "./runs";
import { WorkflowExecutor } from "./test-executor";

const REPO: Repo = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const MAIN_SHA = "a".repeat(40);
const NOW = new Date("2026-11-12T22:00:00.000Z");

/** Branches by name; `createBranch` reports "exists" for one that is there, like GitHub. */
class FakeBranchHost implements EpicBranchHost {
  readonly branches = new Map<string, string>([["main", MAIN_SHA]]);
  readonly created: string[] = [];
  /** A branch someone else makes between the read and the write. */
  racer: string | null = null;
  /** "tip...start" pairs where the tip contains the start commit. */
  readonly descends = new Set<string>();

  async getRepo(fullName: string) {
    return fullName === REPO.fullName ? REPO : null;
  }
  async headContains(_fullName: string, head: string, base: string) {
    return head === base || this.descends.has(`${head}...${base}`);
  }
  async branchSha(_fullName: string, branch: string) {
    return this.branches.get(branch) ?? null;
  }
  async createBranch(_fullName: string, branch: BaseBranch, sha: string) {
    if (this.racer === branch) this.branches.set(branch, "b".repeat(40));
    if (this.branches.has(branch)) return "exists" as const;
    this.branches.set(branch, sha);
    this.created.push(branch);
    return "created" as const;
  }
}

const launch = (over: Partial<NightLaunch> = {}) =>
  NightLaunch.parse({
    id: "launch-1",
    projectId: "ai",
    epicId: "epic-1",
    epicKey: "AI-84",
    budget: { maxRuns: 20, maxTokens: 5_000_000, maxUsd: 50 },
    stopAt: "2026-11-13T06:00:00.000Z",
    status: "running",
    storyKeys: ["AI-2"],
    createdAt: NOW.toISOString(),
    createdBy: "andy",
    startedAt: NOW.toISOString(),
    epicBranch: { name: "epic/AI-84", sha: MAIN_SHA },
    ...over,
  });

const EPIC = { id: "epic-1", key: "AI-84" };

describe("EpicBranches (AI-122)", () => {
  let tracker: InMemoryWorkTracker;
  let host: FakeBranchHost;
  let launches: InMemoryNightLaunchStore;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker(() => NOW);
    host = new FakeBranchHost();
    launches = new InMemoryNightLaunchStore();
    await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] });
  });

  it("GivenALaunch_WhenItsEpicBranchIsOpened_ThenItIsCreatedAtTheDefaultBranchTip", async () => {
    const branch = await new EpicBranches(tracker, host, launches).open("ai", EPIC);

    expect(branch).toEqual({ name: "epic/AI-84", sha: MAIN_SHA });
    expect(host.branches.get("epic/AI-84")).toBe(MAIN_SHA);
    expect(host.created).toEqual(["epic/AI-84"]);
  });

  it("GivenTheEpicBranchAlreadyExists_WhenOpened_ThenRefusedAndNothingIsWritten", async () => {
    host.branches.set("epic/AI-84", "c".repeat(40));

    await expect(new EpicBranches(tracker, host, launches).open("ai", EPIC)).rejects.toMatchObject({
      code: "not_buildable",
      message: expect.stringContaining("already exists"),
    });
    expect(host.created).toEqual([]);
    expect(host.branches.get("epic/AI-84")).toBe("c".repeat(40));
  });

  const ended = (over: Partial<NightLaunch> = {}) =>
    launch({ status: "ended", endedAt: NOW.toISOString(), endReason: "stop_time", ...over });

  it("GivenTheEpicsPreviousLaunchMadeTheBranch_WhenLaunchedAgain_ThenTheBranchIsReusedWithItsStart", async () => {
    const moved = "d".repeat(40);
    host.branches.set("epic/AI-84", moved);
    host.descends.add(`${moved}...${MAIN_SHA}`);
    await launches.create(ended());

    const branch = await new EpicBranches(tracker, host, launches).open("ai", EPIC);

    expect(branch).toEqual({ name: "epic/AI-84", sha: MAIN_SHA });
    expect(host.created).toEqual([]);
    expect(host.branches.get("epic/AI-84")).toBe(moved);
  });

  it("GivenTheBranchNoLongerContainsThePreviousStart_WhenLaunchedAgain_ThenRefused", async () => {
    host.branches.set("epic/AI-84", "e".repeat(40));
    await launches.create(ended());

    await expect(new EpicBranches(tracker, host, launches).open("ai", EPIC)).rejects.toMatchObject({
      code: "not_buildable",
    });
  });

  it("GivenTheBranchWasRecordedByAnotherEpicsLaunchOrNone_WhenLaunched_ThenRefused", async () => {
    host.branches.set("epic/AI-84", MAIN_SHA);
    await launches.create(ended({ id: "other", epicId: "epic-2" }));

    await expect(new EpicBranches(tracker, host, launches).open("ai", EPIC)).rejects.toMatchObject({
      code: "not_buildable",
    });
  });

  it("GivenThePreviousLaunchHadNoEpicBranch_WhenLaunchedAgain_ThenAnExistingBranchIsRefused", async () => {
    host.branches.set("epic/AI-84", MAIN_SHA);
    await launches.create(ended({ epicBranch: null }));

    await expect(new EpicBranches(tracker, host, launches).open("ai", EPIC)).rejects.toMatchObject({
      code: "not_buildable",
    });
  });

  it("GivenOnlyAnOlderLaunchRecordedTheBranch_WhenLaunchedAgain_ThenRefused", async () => {
    host.branches.set("epic/AI-84", MAIN_SHA);
    await launches.create(ended({ id: "old", createdAt: "2026-11-10T22:00:00.000Z" }));
    await launches.create(ended({ id: "newer", epicBranch: null }));

    await expect(new EpicBranches(tracker, host, launches).open("ai", EPIC)).rejects.toMatchObject({
      code: "not_buildable",
    });
  });

  it("GivenTheBranchAppearsBetweenTheReadAndTheWrite_WhenOpened_ThenRefused", async () => {
    host.racer = "epic/AI-84";

    await expect(new EpicBranches(tracker, host, launches).open("ai", EPIC)).rejects.toMatchObject({
      code: "not_buildable",
    });
    expect(host.created).toEqual([]);
  });

  it("GivenAProjectWithoutARepo_WhenOpened_ThenRefused", async () => {
    await tracker.createProject({ name: "BB", key: "BB" });

    await expect(
      new EpicBranches(tracker, host, launches).open("bb", { id: "epic-b", key: "BB-1" }),
    ).rejects.toMatchObject({
      code: "not_buildable",
    });
  });

  it("GivenAKeyThatIsNotATicketKey_WhenOpened_ThenItThrowsBeforeAnyWrite", async () => {
    await expect(
      new EpicBranches(tracker, host, launches).open("ai", { id: "epic-x", key: "AI-1/../main" }),
    ).rejects.toThrow();
    expect(host.created).toEqual([]);
  });
});

describe("buildBaseBranch (AI-122)", () => {
  it("GivenAStoryInTheRunningLaunch_WhenItsBaseIsAsked_ThenTheEpicBranch", async () => {
    const store = new InMemoryNightLaunchStore();
    await store.create(launch());

    expect(await buildBaseBranch(store, "ai", "AI-2")).toBe("epic/AI-84");
  });

  it("GivenATicketTheLaunchDoesNotCover_WhenItsBaseIsAsked_ThenNull", async () => {
    const store = new InMemoryNightLaunchStore();
    await store.create(launch());

    expect(await buildBaseBranch(store, "ai", "AI-3")).toBeNull();
    expect(await buildBaseBranch(store, "bb", "AI-2")).toBeNull();
  });

  it("GivenNoActiveLaunch_WhenItsBaseIsAsked_ThenNull", async () => {
    const store = new InMemoryNightLaunchStore();
    await store.create(
      launch({
        status: "ended",
        endedAt: NOW.toISOString(),
        endReason: "done",
      }),
    );

    expect(await buildBaseBranch(store, "ai", "AI-2")).toBeNull();
  });

  it("GivenALaunchWithoutAnEpicBranch_WhenItsBaseIsAsked_ThenNull", async () => {
    const store = new InMemoryNightLaunchStore();
    await store.create(launch({ epicBranch: null }));

    expect(await buildBaseBranch(store, "ai", "AI-2")).toBeNull();
  });
});

describe("RunService build base branch (AI-122)", () => {
  let tracker: InMemoryWorkTracker;
  let launches: InMemoryNightLaunchStore;
  let runStore: InMemoryRunStore;
  let service: RunService;

  const readyStory = async (title: string, extra: Partial<NewTicket> = {}) => {
    const t = await tracker.createTicket(
      "ai",
      {
        type: "feature",
        title,
        body: "Why.",
        acceptanceCriteria: ["WHEN x THE SYSTEM SHALL y"],
        size: "S",
        sizeReason: "small",
        ...extra,
      },
      "andy",
    );
    return tracker.updateTicket(
      "ai",
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
  };

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker(() => NOW);
    launches = new InMemoryNightLaunchStore();
    runStore = new InMemoryRunStore(() => NOW);
    service = new RunService(
      tracker,
      runStore,
      new WorkflowExecutor(new InMemoryCodeHost([REPO])),
      () => NOW,
      null,
      null,
      null,
      null,
      launches,
    );
    await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] });
    await tracker.updateProject("ai", { buildEnabled: true });
  });

  it("GivenAStoryInARunningLaunch_WhenItsBuildStarts_ThenItBranchesFromAndTargetsTheEpicBranch", async () => {
    const story = await readyStory("Story");
    await launches.create(launch({ storyKeys: [story.key] }));

    const run = await service.start("ai", story.id, "build");
    const context = await service.context(run.id, run.executor!);

    expect(run.baseBranch).toBe("epic/AI-84");
    expect(context).toMatchObject({ step: "build", baseBranch: "epic/AI-84" });
    expect(context.branch).toBe(`agent/${story.key}/${run.id}`);
  });

  it("GivenATicketOutsideAnyLaunch_WhenItsBuildStarts_ThenItBuildsOnTheDefaultBranch", async () => {
    const other = await readyStory("Not launched");
    await launches.create(launch({ storyKeys: ["AI-99"] }));

    const run = await service.start("ai", other.id, "build");
    const context = await service.context(run.id, run.executor!);

    expect(run.baseBranch).toBeNull();
    expect(context.baseBranch).toBeNull();
  });

  it("GivenARefineOfALaunchedStory_WhenItStarts_ThenItHasNoBaseBranch", async () => {
    const t = await tracker.createTicket("ai", { type: "feature", title: "Idea" }, "andy");
    await tracker.updateTicket("ai", t.id, { fields: { upNextRank: "0000000001" } }, "andy");
    await launches.create(launch({ storyKeys: [t.key] }));

    const run = await service.start("ai", t.id, "refine");

    expect(run.baseBranch).toBeNull();
  });

  const failBuild = async (run: Run) => {
    await service.context(run.id, run.executor!);
    await service.report(run.id, run.executor!, {
      status: "failed",
      summary: "broke",
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
    });
  };

  it("GivenAFailedBuildWhileTheLaunchRuns_WhenItIsRetried_ThenTheRetryKeepsTheEpicBranch", async () => {
    const story = await readyStory("Story");
    await launches.create(launch({ storyKeys: [story.key] }));
    const first = await service.start("ai", story.id, "build");

    // A failed build retries itself once (ADR-0028).
    await failBuild(first);

    const retry = (await runStore.listForTicket("ai", story.id)).find(
      (r) => r.retryOf === first.id,
    );
    expect(retry?.baseBranch).toBe("epic/AI-84");
  });

  it("GivenAFailedBuildAfterTheLaunchEnded_WhenItIsRetried_ThenNoRetryStartsAndAndyIsAsked", async () => {
    const story = await readyStory("Story");
    await launches.create(launch({ storyKeys: [story.key] }));
    const first = await service.start("ai", story.id, "build");
    await launches.transition("launch-1", ["running"], {
      status: "ended",
      endedAt: NOW.toISOString(),
      endReason: "stopped",
    });

    await failBuild(first);

    const runs = await runStore.listForTicket("ai", story.id);
    expect(runs.find((r) => r.retryOf === first.id)).toBeUndefined();
    const ticket = await tracker.getTicket("ai", story.id);
    expect(ticket?.needsAttention).toBe(true);
    const events = await tracker.listEvents("ai", story.id);
    expect(events.at(-1)?.body).toContain("night launch is over");
  });

  it("GivenALaunchedStory_WhenALocalRunnerStartsItsBuild_ThenRefusedRatherThanBuiltOnMain", async () => {
    const story = await readyStory("Story", { overrides: { executor: "local" } });
    await launches.create(launch({ storyKeys: [story.key] }));
    const runner = { id: "runner-1", projectIds: ["ai"] } as unknown as Runner;

    await expect(
      service.start("ai", story.id, "build", undefined, { runner }),
    ).rejects.toMatchObject({
      code: "not_buildable",
      message: expect.stringContaining("local runner"),
    });
  });
});
