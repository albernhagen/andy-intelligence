import {
  InMemoryCodeHost,
  InMemoryNightLaunchStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  NightLaunch,
  type BaseBranch,
  type Repo,
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

  async getRepo(fullName: string) {
    return fullName === REPO.fullName ? REPO : null;
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

describe("EpicBranches (AI-122)", () => {
  let tracker: InMemoryWorkTracker;
  let host: FakeBranchHost;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker(() => NOW);
    host = new FakeBranchHost();
    await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] });
  });

  it("GivenALaunch_WhenItsEpicBranchIsOpened_ThenItIsCreatedAtTheDefaultBranchTip", async () => {
    const branch = await new EpicBranches(tracker, host).open("ai", "AI-84");

    expect(branch).toEqual({ name: "epic/AI-84", sha: MAIN_SHA });
    expect(host.branches.get("epic/AI-84")).toBe(MAIN_SHA);
    expect(host.created).toEqual(["epic/AI-84"]);
  });

  it("GivenTheEpicBranchAlreadyExists_WhenOpened_ThenRefusedAndNothingIsWritten", async () => {
    host.branches.set("epic/AI-84", "c".repeat(40));

    await expect(new EpicBranches(tracker, host).open("ai", "AI-84")).rejects.toMatchObject({
      code: "not_buildable",
      message: expect.stringContaining("already exists"),
    });
    expect(host.created).toEqual([]);
    expect(host.branches.get("epic/AI-84")).toBe("c".repeat(40));
  });

  it("GivenTheBranchAppearsBetweenTheReadAndTheWrite_WhenOpened_ThenRefused", async () => {
    host.racer = "epic/AI-84";

    await expect(new EpicBranches(tracker, host).open("ai", "AI-84")).rejects.toMatchObject({
      code: "not_buildable",
    });
    expect(host.created).toEqual([]);
  });

  it("GivenAProjectWithoutARepo_WhenOpened_ThenRefused", async () => {
    await tracker.createProject({ name: "BB", key: "BB" });

    await expect(new EpicBranches(tracker, host).open("bb", "BB-1")).rejects.toMatchObject({
      code: "not_buildable",
    });
  });

  it("GivenAKeyThatIsNotATicketKey_WhenOpened_ThenItThrowsBeforeAnyWrite", async () => {
    await expect(new EpicBranches(tracker, host).open("ai", "AI-1/../main")).rejects.toThrow();
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

  const readyStory = async (title: string) => {
    const t = await tracker.createTicket(
      "ai",
      {
        type: "feature",
        title,
        body: "Why.",
        acceptanceCriteria: ["WHEN x THE SYSTEM SHALL y"],
        size: "S",
        sizeReason: "small",
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

  it("GivenAFailedBuildRetriedAfterTheLaunchEnded_WhenTheRetryStarts_ThenItKeepsItsRunsEpicBranch", async () => {
    const story = await readyStory("Story");
    await launches.create(launch({ storyKeys: [story.key] }));
    const first = await service.start("ai", story.id, "build");
    await service.context(first.id, first.executor!);
    await launches.transition("launch-1", ["running"], {
      status: "ended",
      endedAt: NOW.toISOString(),
      endReason: "stopped",
    });

    // A failed build retries itself once (ADR-0028); the launch is over by then.
    await service.report(first.id, first.executor!, {
      status: "failed",
      summary: "broke",
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
    });

    const retry = (await runStore.listForTicket("ai", story.id)).find(
      (r) => r.retryOf === first.id,
    );
    expect(retry?.baseBranch).toBe("epic/AI-84");
  });
});
