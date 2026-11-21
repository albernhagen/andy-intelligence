import {
  InMemoryCodeHost,
  InMemoryNightLaunchStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type AutoMerge,
  type HeadCheck,
  type NightEndReason,
  type NightLaunch,
  type PullRequest,
  type Repo,
  type Run,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PullRequestGate } from "./gate-service";
import { NightLaunches } from "./night-launch";
import {
  EpicMerges,
  MorningPullRequests,
  epicMergeAttempted,
  mergedStories,
  morningPrBody,
  morningPrTitle,
  passesIntoEpic,
  type MorningPrHost,
} from "./night-merge";
import { TicketService } from "./tickets";

const REPO: Repo = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const START_SHA = "a".repeat(40);
const APP_URL = "https://ai.example.com";
const REQUIRED = ["check", "adversarial-review", "security-review"];

/** The CodeHost fake plus the morning PR writes, recorded. */
class NightHost extends InMemoryCodeHost implements MorningPrHost {
  readonly branches = new Map<string, string>();
  readonly opened: { head: string; base: string; title: string; body: string }[] = [];
  readonly deleted: string[] = [];
  /** Test seam: an open PR from this head is already there. */
  existing: string | null = null;

  async branchSha(_fullName: string, branch: string) {
    return this.branches.get(branch) ?? null;
  }
  async openEpicPullRequest(
    _fullName: string,
    pr: { head: string; base: string; title: string; body: string },
  ) {
    if (this.existing === pr.head) return "exists" as const;
    this.opened.push(pr);
    return { number: 900, url: `${REPO.url}/pull/900` };
  }
  async deleteEpicBranch(_fullName: string, branch: string) {
    this.deleted.push(branch);
    this.branches.delete(branch);
  }
}

const passed = (name: string): HeadCheck => ({
  name,
  status: "completed",
  conclusion: "success",
  sourceId: "15368",
});

describe("passesIntoEpic", () => {
  it("GivenOnlyNotDefaultBranch_WhenAsked_ThenItPasses", () => {
    expect(passesIntoEpic({ reasons: ["not_default_branch"] })).toBe(true);
  });

  it("GivenAnyOtherReasonOrNone_WhenAsked_ThenItDoesNot", () => {
    expect(passesIntoEpic({ reasons: [] })).toBe(false);
    expect(passesIntoEpic({ reasons: ["not_default_branch", "checks_pending"] })).toBe(false);
    expect(passesIntoEpic({ reasons: ["protected_path", "not_default_branch"] })).toBe(false);
    expect(passesIntoEpic({ reasons: ["checks_failed"] })).toBe(false);
  });
});

describe("night merges into the epic branch (AI-124)", () => {
  let tracker: InMemoryWorkTracker;
  let runs: InMemoryRunStore;
  let host: NightHost;
  let nights: InMemoryNightLaunchStore;
  let tickets: TicketService;
  let projectId: string;
  let epic: Ticket;
  let ms: number;
  const now = () => new Date(ms);
  let prNumber: number;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    ms = Date.parse("2026-11-20T22:00:00.000Z");
    prNumber = 40;
    tracker = new InMemoryWorkTracker();
    runs = new InMemoryRunStore(now);
    host = new NightHost([REPO]);
    host.requiredChecks = REQUIRED.map((name) => ({ name, sourceId: "15368" }));
    host.branches.set("epic/AI-1", START_SHA);
    nights = new InMemoryNightLaunchStore();
    tickets = new TicketService(tracker, null, null, now);
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    epic = await tracker.createTicket(projectId, { type: "epic", title: "Night work" }, "andy");
  });

  const gate = (withEpics = true) =>
    new PullRequestGate(
      host,
      tracker,
      runs,
      tickets,
      now,
      null,
      withEpics ? new EpicMerges(nights, runs) : null,
    );

  async function setPolicy(autoMerge: AutoMerge) {
    await tracker.updateProject(projectId, { autoMerge });
  }

  async function launch(storyKeys: string[], over: Partial<NightLaunch> = {}) {
    const at = now().toISOString();
    return nights.create({
      id: "launch-1",
      projectId,
      epicId: epic.id,
      epicKey: epic.key,
      budget: { maxRuns: 10, maxTokens: 1_000_000, maxUsd: 50 },
      stopAt: new Date(ms + 3_600_000).toISOString(),
      status: "running",
      storyKeys,
      createdAt: at,
      createdBy: "user:andy",
      startedAt: at,
      endedAt: null,
      endReason: null,
      epicBranch: { name: `epic/${epic.key}`, sha: START_SHA },
      stoppedStories: [],
      ...over,
    });
  }

  async function story(title: string): Promise<Ticket> {
    const t = await tracker.createTicket(
      projectId,
      {
        type: "feature",
        title,
        body: "Andy can't see it.",
        acceptanceCriteria: ["WHEN Andy looks THE SYSTEM SHALL show it"],
        size: "S",
        sizeReason: "small",
        parentId: epic.id,
      },
      "andy",
    );
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "in_progress", forced: true, reason: null } },
      "andy",
    );
  }

  /** A succeeded build run of `ticket` whose PR (open, all checks green) targets `baseRef`. */
  async function agentPr(
    ticket: Ticket,
    baseRef = "epic/AI-1",
    opts: { runBase?: string | null; files?: string[]; checks?: HeadCheck[] } = {},
  ): Promise<{ run: Run; pr: PullRequest }> {
    const number = ++prNumber;
    const intoDefault = baseRef === "main";
    const runBase = opts.runBase !== undefined ? opts.runBase : intoDefault ? null : baseRef;
    const created = await runs.create({
      projectId,
      ticketId: ticket.id,
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: "fast",
      deadline: null,
      baseBranch: runBase as Run["baseBranch"],
    });
    const branch = `agent/${ticket.key}/${created.id}`;
    const url = `${REPO.url}/pull/${number}`;
    await runs.update(created.id, { status: "running" }, ["queued"]);
    const run = await runs.update(
      created.id,
      {
        status: "succeeded",
        branch,
        links: { pullRequest: url },
        verification: [{ command: "pnpm test", passed: true, output: "12 passed" }],
      },
      ["running"],
    );
    const pr: PullRequest = {
      number,
      state: "open",
      draft: false,
      title: ticket.title,
      bodyFirstLine: "",
      fromFork: false,
      intoDefaultBranch: intoDefault,
      headRef: branch,
      headSha: `head${number}`,
      baseRef,
      url,
    };
    host.pullRequests.set(number, {
      pullRequest: pr,
      files: {
        items: (opts.files ?? ["apps/web/src/a.tsx"]).map((path) => ({ path, previousPath: null })),
        complete: true,
      },
      checks: { items: opts.checks ?? REQUIRED.map(passed), complete: true },
      commits: { items: [], complete: true },
    });
    return { run, pr };
  }

  const opened = (pr: PullRequest) => ({
    kind: "pull_request" as const,
    deliveryId: `d-${pr.number}-${ms}`,
    projectId,
    repo: REPO.fullName,
    action: "opened",
    receivedAt: now().toISOString(),
    pullRequest: pr,
  });

  const project = async () => (await tracker.getProject(projectId))!;
  const stageOf = async (t: Ticket) => (await tracker.getTicket(projectId, t.id))!.stage;

  describe("PullRequestGate", () => {
    it("GivenAStoryPrIntoItsRunningLaunchsEpicBranch_WhenTheGatePasses_ThenItMergesThereWhateverThePolicy", async () => {
      await setPolicy("none");
      const a = await story("A");
      await launch([a.key]);
      const { run, pr } = await agentPr(a);

      const [result] = await gate().apply(opened(pr), await project());

      expect(result).toMatchObject({ result: "merged", pr: pr.number });
      expect(host.merges).toEqual([
        { fullName: REPO.fullName, number: pr.number, sha: pr.headSha },
      ]);
      const after = (await runs.get(run.id))!;
      expect(after.epicMerge).toEqual({ at: now().toISOString(), sha: expect.any(String) });
      // Only the default branch makes `wouldAutoMerge`; the epic branch never does.
      expect(after.wouldAutoMerge).toBe(false);
      expect(after.gateReasons).toEqual(["not_default_branch"]);
      expect(await stageOf(a)).toBe("done");
    });

    it("GivenAStoryPrIntoTheEpicBranch_WhenAssessed_ThenTheDefaultBranchsChecksAndCodeownersApply", async () => {
      const a = await story("A");
      await launch([a.key]);
      const { pr } = await agentPr(a);
      const required = vi.spyOn(host, "listRequiredChecks");
      const read = vi.spyOn(host, "readFile");

      await gate().apply(opened(pr), await project());

      expect(required).toHaveBeenCalledWith(REPO.fullName, "main");
      expect(read.mock.calls.every((call) => (call as unknown[])[2] === "main")).toBe(true);
    });

    it("GivenTheDefaultBranchRequiresAMissingCheck_WhenAStoryPrIsAssessed_ThenItStaysOpen", async () => {
      host.requiredChecks = [...REQUIRED, "e2e"].map((name) => ({ name, sourceId: "15368" }));
      const a = await story("A");
      await launch([a.key]);
      const { pr } = await agentPr(a);

      const [result] = await gate().apply(opened(pr), await project());

      expect(result).toMatchObject({ result: "assessed" });
      expect(host.merges).toEqual([]);
    });

    it.each([
      [
        "a failing review",
        {
          checks: [
            passed("check"),
            passed("security-review"),
            { ...passed("adversarial-review"), conclusion: "failure" as const },
          ],
        },
      ],
      ["a protected path", { files: ["infra/main.tf"] }],
      ["pending checks", { checks: [passed("check")] }],
    ])("GivenAStoryPrWith%s_WhenTheGateVetoes_ThenItStaysOpenAndUnmerged", async (_name, opts) => {
      const a = await story("A");
      await launch([a.key]);
      const { run, pr } = await agentPr(a, "epic/AI-1", opts);

      const [result] = await gate().apply(opened(pr), await project());

      expect(result).toMatchObject({ result: "assessed" });
      expect(host.merges).toEqual([]);
      expect(host.pullRequests.get(pr.number)!.pullRequest.state).toBe("open");
      expect((await runs.get(run.id))!.epicMerge).toBeNull();
      expect(await stageOf(a)).toBe("in_progress");
    });

    it("GivenADraftStoryPr_WhenAssessed_ThenItStaysOpen", async () => {
      const a = await story("A");
      await launch([a.key]);
      const { pr } = await agentPr(a);
      host.pullRequests.get(pr.number)!.pullRequest.draft = true;

      await gate().apply(opened({ ...pr, draft: true }), await project());
      expect(host.merges).toEqual([]);
    });

    it("GivenAnEndedLaunch_WhenItsStoryPrPasses_ThenItStaysOpen", async () => {
      const a = await story("A");
      await launch([a.key], {
        status: "ended",
        endedAt: now().toISOString(),
        endReason: "stop_time",
      });
      const { pr } = await agentPr(a);

      await gate().apply(opened(pr), await project());
      expect(host.merges).toEqual([]);
    });

    it("GivenAStoppingLaunch_WhenAnInFlightStorysPrPasses_ThenItStillMerges", async () => {
      const a = await story("A");
      await launch([a.key], { status: "stopping" });
      const { pr } = await agentPr(a);

      const [result] = await gate().apply(opened(pr), await project());
      expect(result).toMatchObject({ result: "merged" });
    });

    it("GivenATicketTheLaunchDoesntCover_WhenItsPrIntoTheEpicBranchPasses_ThenItStaysOpen", async () => {
      const a = await story("A");
      const other = await story("Other");
      await launch([a.key]);
      const { pr } = await agentPr(other);

      await gate().apply(opened(pr), await project());
      expect(host.merges).toEqual([]);
    });

    it("GivenAPrIntoAnotherEpicBranchOrARunBuiltElsewhere_WhenItPasses_ThenItStaysOpen", async () => {
      const a = await story("A");
      await launch([a.key]);
      host.branches.set("epic/AI-9", START_SHA);
      const wrongBase = await agentPr(a, "epic/AI-9");
      const wrongRun = await agentPr(a, "epic/AI-1", { runBase: null });

      await gate().apply(opened(wrongBase.pr), await project());
      await gate().apply(opened(wrongRun.pr), await project());
      expect(host.merges).toEqual([]);
    });

    it("GivenNoEpicMerges_WhenAStoryPrPasses_ThenItStaysOpen", async () => {
      const a = await story("A");
      await launch([a.key]);
      const { pr } = await agentPr(a);

      await gate(false).apply(opened(pr), await project());
      expect(host.merges).toEqual([]);
    });

    it("GivenAStoryAlreadyMergedThisLaunch_WhenAnotherOfItsPrsPasses_ThenItStaysOpen", async () => {
      const a = await story("A");
      await launch([a.key]);
      await gate().apply(opened((await agentPr(a)).pr), await project());
      // As if its move to Done had failed: back in progress, a new PR from a new build.
      await tracker.updateTicket(
        projectId,
        a.id,
        { stage: { to: "in_progress", forced: true, reason: null } },
        "andy",
      );
      const again = await agentPr((await tracker.getTicket(projectId, a.id))!);

      const [result] = await gate().apply(opened(again.pr), await project());

      expect(result).toMatchObject({ result: "assessed" });
      expect(host.merges).toHaveLength(1);
    });

    it("GivenTheMergeRecordWriteFailed_WhenANewHeadOfTheStoryPasses_ThenItIsNotMergedAgain", async () => {
      const a = await story("A");
      await launch([a.key]);
      const { pr } = await agentPr(a);
      const update = runs.update.bind(runs);
      vi.spyOn(runs, "update").mockImplementation(async (id, patch, from) =>
        patch.epicMerge ? Promise.reject(new Error("store down")) : update(id, patch, from),
      );
      await gate().apply(opened(pr), await project());
      expect(host.merges).toHaveLength(1);

      // Before the close webhook recovers: a new head on the same PR, and a PR from a new run.
      const moved = { ...pr, headSha: "newhead" };
      host.pullRequests.get(pr.number)!.pullRequest = moved;
      host.pullRequests.get(pr.number)!.pullRequest.state = "open";
      const [sameRun] = await gate().apply(
        { ...opened(moved), action: "synchronize" },
        await project(),
      );
      const other = await agentPr((await tracker.getTicket(projectId, a.id))!);
      const [newRun] = await gate().apply(opened(other.pr), await project());

      expect(sameRun).toMatchObject({ result: "assessed" });
      expect(newRun).toMatchObject({ result: "assessed" });
      expect(host.merges).toHaveLength(1);
    });

    it("GivenTheBookkeepingFailsAfterTheMerge_WhenThePrsCloseArrives_ThenItIsFlaggedThenRecoveredAndDone", async () => {
      const a = await story("A");
      await launch([a.key]);
      const { run, pr } = await agentPr(a);
      const update = runs.update.bind(runs);
      const failing = vi
        .spyOn(runs, "update")
        .mockImplementation(async (id, patch, from) =>
          patch.epicMerge ? Promise.reject(new Error("store down")) : update(id, patch, from),
        );

      const [result] = await gate().apply(opened(pr), await project());

      expect(result).toMatchObject({ result: "merged" });
      expect(host.merges).toHaveLength(1);
      expect((await runs.get(run.id))!.epicMerge).toBeNull();
      const flagged = (await tracker.getTicket(projectId, a.id))!;
      expect(flagged).toMatchObject({ stage: "in_progress", needsAttention: true });
      const events = await tracker.listEvents(projectId, a.id);
      expect(JSON.stringify(events)).toContain("recording it failed");

      failing.mockRestore();
      const merged = { ...pr, state: "merged" as const };
      host.pullRequests.get(pr.number)!.pullRequest = merged;
      await gate().apply({ ...opened(merged), action: "closed" }, await project());

      expect((await runs.get(run.id))!.epicMerge).toEqual({ at: now().toISOString(), sha: null });
      expect(await stageOf(a)).toBe("done");
    });

    it("GivenAMergeRecordedAlready_WhenThePrsCloseArrives_ThenItsShaIsKept", async () => {
      const a = await story("A");
      await launch([a.key]);
      const { run, pr } = await agentPr(a);
      await gate().apply(opened(pr), await project());
      const recorded = (await runs.get(run.id))!.epicMerge;

      const merged = { ...pr, state: "merged" as const };
      host.pullRequests.get(pr.number)!.pullRequest = merged;
      ms += 60_000;
      await gate().apply({ ...opened(merged), action: "closed" }, await project());

      expect((await runs.get(run.id))!.epicMerge).toEqual(recorded);
      expect(recorded!.sha).not.toBeNull();
    });

    it("GivenAMergeTheHostRefuses_WhenAStoryPrPasses_ThenItIsFlaggedAndNotDone", async () => {
      const a = await story("A");
      await launch([a.key]);
      const { run, pr } = await agentPr(a);
      host.failMerge = new Error("merge conflict");

      const [result] = await gate().apply(opened(pr), await project());

      expect(result).toMatchObject({ result: "merge_failed" });
      expect((await runs.get(run.id))!.epicMerge).toBeNull();
      const after = (await tracker.getTicket(projectId, a.id))!;
      expect(after).toMatchObject({ stage: "in_progress", needsAttention: true });
    });

    it("GivenAPrIntoMain_WhenThePolicyIsNone_ThenItIsNotMergedAsBefore", async () => {
      await setPolicy("none");
      const a = await story("A");
      await tracker.updateTicket(
        projectId,
        a.id,
        { stage: { to: "ready_for_review", forced: true, reason: null } },
        "andy",
      );
      await launch([a.key]);
      const { run, pr } = await agentPr((await tracker.getTicket(projectId, a.id))!, "main");
      const required = vi.spyOn(host, "listRequiredChecks");

      const [result] = await gate().apply(opened(pr), await project());

      expect(result).toMatchObject({ result: "assessed" });
      expect(host.merges).toEqual([]);
      expect((await runs.get(run.id))!.wouldAutoMerge).toBe(true);
      expect(required).toHaveBeenCalledWith(REPO.fullName, "main");
    });

    it("GivenAPrIntoMain_WhenThePolicyAllows_ThenItAutoMergesWithoutAnEpicMerge", async () => {
      await setPolicy("all");
      const a = await story("A");
      const review = await tracker.updateTicket(
        projectId,
        a.id,
        { stage: { to: "ready_for_review", forced: true, reason: null } },
        "andy",
      );
      const { run, pr } = await agentPr(review, "main");

      const [result] = await gate().apply(opened(pr), await project());

      expect(result).toMatchObject({ result: "merged" });
      expect((await runs.get(run.id))!.epicMerge).toBeNull();
      // Done comes from the merged PR's webhook into the default branch, as before.
      expect(await stageOf(a)).toBe("ready_for_review");
    });
  });

  describe("MorningPullRequests", () => {
    const morning = () => new MorningPullRequests(tracker, runs, host, APP_URL, tickets);
    const end = async (reason: NightEndReason = "done") =>
      nights.transition("launch-1", ["running", "stopping"], {
        status: "ended",
        endedAt: now().toISOString(),
        endReason: reason,
      });

    it("GivenTwoMergedStories_WhenTheLaunchEnds_ThenOnePrToMainListsEachStorysCommitRangeAndPr", async () => {
      const a = await story("A");
      const b = await story("B");
      const c = await story("C");
      await launch([a.key, b.key, c.key]);
      const first = await agentPr(a);
      await gate().apply(opened(first.pr), await project());
      ms += 60_000;
      const second = await agentPr(b);
      await gate().apply(opened(second.pr), await project());

      const result = await morning().open(await end("stop_time"));

      expect(result).toMatchObject({ result: "opened", number: 900, stories: 2 });
      expect(host.opened).toHaveLength(1);
      const pr = host.opened[0]!;
      expect(pr).toMatchObject({
        head: "epic/AI-1",
        base: "main",
        title: "AI-1: Night work (overnight)",
      });
      const lines = pr.body.split("\n");
      expect(lines[0]).toBe(`${APP_URL}/p/${projectId}/t/AI-1`);
      const shaA = (await runs.get(first.run.id))!.epicMerge!.sha!;
      const shaB = (await runs.get(second.run.id))!.epicMerge!.sha!;
      expect(pr.body).toContain(
        `| ${a.key} | \`${START_SHA.slice(0, 12)}..${shaA.slice(0, 12)}\` | ${first.pr.url} |`,
      );
      expect(pr.body).toContain(
        `| ${b.key} | \`${shaA.slice(0, 12)}..${shaB.slice(0, 12)}\` | ${second.pr.url} |`,
      );
      expect(pr.body).not.toContain(c.key);
      expect(pr.body).toContain("its stop time passed");
      expect(pr.body).toContain("never merges on its own");
      expect(host.deleted).toEqual([]);
    });

    it("GivenTheMorningPr_WhenItsChecksPass_ThenTheGateNeverMergesIt", async () => {
      await setPolicy("all");
      const a = await story("A");
      await launch([a.key]);
      await gate().apply(opened((await agentPr(a)).pr), await project());
      await morning().open(await end());
      const morningPr: PullRequest = {
        number: 900,
        state: "open",
        draft: false,
        title: "AI-1: Night work (overnight)",
        bodyFirstLine: `${APP_URL}/p/${projectId}/t/AI-1`,
        fromFork: false,
        intoDefaultBranch: true,
        headRef: "epic/AI-1",
        headSha: "morninghead",
        baseRef: "main",
        url: `${REPO.url}/pull/900`,
      };
      host.pullRequests.set(900, {
        pullRequest: morningPr,
        files: { items: [], complete: true },
        checks: { items: REQUIRED.map(passed), complete: true },
        commits: { items: [], complete: true },
      });
      const merges = host.merges.length;

      const [result] = await gate().apply(opened(morningPr), await project());

      expect(result).toMatchObject({ result: "ignored" });
      expect(host.merges).toHaveLength(merges);
    });

    it("GivenNoStoryMerged_WhenTheLaunchEnds_ThenNoPrOpensAndTheEpicBranchIsDeleted", async () => {
      const a = await story("A");
      await launch([a.key]);
      await agentPr(a, "epic/AI-1", { files: ["infra/main.tf"] });

      const result = await morning().open(await end("max_runs"));

      expect(result).toEqual({ result: "deleted" });
      expect(host.opened).toEqual([]);
      expect(host.deleted).toEqual(["epic/AI-1"]);
    });

    it("GivenNoStoryMergedOnAReusedBranchWithEarlierWork_WhenTheLaunchEnds_ThenTheBranchIsKept", async () => {
      const a = await story("A");
      await launch([a.key]);
      host.branches.set("epic/AI-1", "e".repeat(40));

      expect(await morning().open(await end())).toEqual({ result: "kept" });
      expect(host.deleted).toEqual([]);
      expect(host.opened).toEqual([]);
    });

    it("GivenAMergeFromAnEarlierLaunch_WhenThisLaunchEnds_ThenItIsNotListed", async () => {
      const a = await story("A");
      await launch([a.key]);
      const { run } = await agentPr(a);
      await runs.update(
        run.id,
        { epicMerge: { at: "2026-11-19T22:00:00.000Z", sha: "f".repeat(40) } },
        ["succeeded"],
      );

      expect(await morning().open(await end())).toEqual({ result: "deleted" });
    });

    it("GivenAnOpenMorningPrAlready_WhenOpenedAgain_ThenNoSecondPr", async () => {
      const a = await story("A");
      await launch([a.key]);
      await gate().apply(opened((await agentPr(a)).pr), await project());
      host.existing = "epic/AI-1";

      expect(await morning().open(await end())).toEqual({ result: "exists", stories: 1 });
      expect(host.opened).toEqual([]);
    });

    it("GivenALaunchStillRunningOrWithoutABranch_WhenOpened_ThenNothingHappens", async () => {
      const a = await story("A");
      const running = await launch([a.key]);
      expect(await morning().open(running)).toEqual({ result: "skipped", reason: "not_ended" });
      const ended = await end();
      expect(await morning().open({ ...ended, epicBranch: null })).toEqual({
        result: "skipped",
        reason: "no_epic_branch",
      });
      expect(host.opened).toEqual([]);
      expect(host.deleted).toEqual([]);
    });

    it("GivenTheHostFails_WhenOpened_ThenItIsLoggedAndReturnedNotThrown", async () => {
      const a = await story("A");
      await launch([a.key]);
      await gate().apply(opened((await agentPr(a)).pr), await project());
      vi.spyOn(host, "openEpicPullRequest").mockRejectedValue(new Error("boom"));

      expect(await morning().open(await end())).toEqual({ result: "failed", error: "boom" });
      // Nothing calls it again once the launch has ended, so the epic is flagged for Andy.
      expect((await tracker.getTicket(projectId, epic.id))!.needsAttention).toBe(true);
      const events = await tracker.listEvents(projectId, epic.id);
      expect(JSON.stringify(events)).toContain("couldn't be opened: boom");
    });

    it("GivenNightLaunchesWithAMorningOpener_WhenALaunchEnds_ThenTheOpenerGetsTheEndedLaunch", async () => {
      const a = await story("A");
      await launch([a.key]);
      const open = vi.fn().mockResolvedValue({ result: "deleted" });
      const launches = new NightLaunches(
        nights,
        tracker,
        { planStateOf: async () => ({ kind: "approved" }) as never },
        now,
        undefined,
        null,
        { open },
      );

      await launches.end("launch-1", "stopped");

      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({ id: "launch-1", status: "ended" }),
      );
    });
  });
});

describe("mergedStories and morningPrBody", () => {
  const launch = {
    startedAt: "2026-11-20T22:00:00.000Z",
    epicBranch: { name: "epic/AI-1" as const, sha: START_SHA },
  };
  const run = (over: Partial<Run>) =>
    ({
      ticketId: "t1",
      step: "build",
      baseBranch: "epic/AI-1",
      links: { pullRequest: `${REPO.url}/pull/1` },
      epicMerge: { at: "2026-11-20T23:00:00.000Z", sha: "b".repeat(40) },
      ...over,
    }) as Run;

  it("GivenSeveralMergesOfOneStory_WhenListed_ThenTheNewestCounts", () => {
    const newer = run({
      links: { pullRequest: `${REPO.url}/pull/2` },
      epicMerge: { at: "2026-11-20T23:30:00.000Z", sha: "c".repeat(40) },
    });
    expect(mergedStories(launch, [{ id: "t1", key: "AI-2" }], [run({}), newer])).toEqual([
      {
        key: "AI-2",
        pullRequest: `${REPO.url}/pull/2`,
        at: "2026-11-20T23:30:00.000Z",
        sha: "c".repeat(40),
      },
    ]);
  });

  it("GivenMergeClaims_WhenAsked_ThenOnlyThisLaunchsEpicBranchBuildsCount", () => {
    const claim = (over: Partial<Run>) =>
      ({
        step: "build",
        baseBranch: "epic/AI-1",
        createdAt: "2026-11-20T22:30:00.000Z",
        mergeAttemptedSha: "head1",
        epicMerge: null,
        ...over,
      }) as Run;
    expect(epicMergeAttempted(launch, [claim({})])).toBe(true);
    expect(epicMergeAttempted(launch, [claim({ mergeAttemptedSha: null })])).toBe(false);
    expect(epicMergeAttempted(launch, [claim({ baseBranch: null })])).toBe(false);
    expect(epicMergeAttempted(launch, [claim({ createdAt: "2026-11-19T22:00:00.000Z" })])).toBe(
      false,
    );
    expect(epicMergeAttempted(launch, [claim({ createdAt: null })])).toBe(true);
  });

  it("GivenRunsOnAnotherBaseOrStep_WhenListed_ThenTheyAreSkipped", () => {
    const stories = [{ id: "t1", key: "AI-2" }];
    expect(mergedStories(launch, stories, [run({ baseBranch: null })])).toEqual([]);
    expect(mergedStories(launch, stories, [run({ step: "sync" })])).toEqual([]);
    expect(mergedStories(launch, stories, [run({ epicMerge: null })])).toEqual([]);
  });

  it("GivenAnEpicTitleWithAMentionAndNewlines_WhenTheTitleIsWritten_ThenNeitherSurvives", () => {
    expect(morningPrTitle("AI-1", "Ping @someone\nnow")).toBe("AI-1: Ping someone now (overnight)");
  });

  it("GivenAMergeWithoutASha_WhenTheBodyIsWritten_ThenItsRangeSaysNotReported", () => {
    const body = morningPrBody(
      "https://x/p/ai/t/AI-1",
      { epicKey: "AI-1", endReason: "done", epicBranch: launch.epicBranch },
      [{ key: "AI-2", pullRequest: "https://x/pull/1", at: launch.startedAt, sha: null }],
    );
    expect(body).toContain("| AI-2 | not reported | https://x/pull/1 |");
    expect(body).toContain("every story finished");
    // AI-125: the PR points at the morning report on the epic.
    expect(body).toContain(
      "The morning report (what merged, what stopped and why, night assumptions, cost) is a comment on https://x/p/ai/t/AI-1.",
    );
  });
});
