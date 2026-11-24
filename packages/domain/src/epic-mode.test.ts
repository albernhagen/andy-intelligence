import {
  InMemoryCodeHost,
  InMemoryNightLaunchStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type HeadCheck,
  type MergeMode,
  type PullRequest,
  type Repo,
  type Run,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EpicMode, MAX_EPIC_CHILDREN, epicPrBody, epicPrTitle } from "./epic-mode";
import { PullRequestGate } from "./gate-service";
import { mergeVerdict } from "./merge-verdict";
import { EpicMerges } from "./night-merge";
import { TicketService } from "./tickets";

/** AI-216: the `epic` merge mode by day, through the night-merge path. */

const REPO: Repo = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const MAIN_TIP = "e".repeat(40);
const APP_URL = "https://ai.example.com";
const REQUIRED = ["check", "adversarial-review", "security-review"];

const passed = (name: string): HeadCheck => ({
  name,
  status: "completed",
  conclusion: "success",
  sourceId: "15368",
});

/** The CodeHost fake with the epic PR writes recorded. */
class EpicHost extends InMemoryCodeHost {
  readonly opened: { head: string; base: string; title: string; body: string }[] = [];
  readonly created: { branch: string; sha: string }[] = [];

  override async createBranch(fullName: string, branch: string, sha: string) {
    const made = await super.createBranch(fullName, branch, sha);
    if (made === "created") this.created.push({ branch, sha });
    return made;
  }
  override async openEpicPullRequest(
    _fullName: string,
    pr: { head: string; base: string; title: string; body: string },
  ) {
    if (this.opened.some((o) => o.head === pr.head && o.base === pr.base)) return "exists" as const;
    this.opened.push(pr);
    return {
      number: 900 + this.opened.length,
      url: `${REPO.url}/pull/${900 + this.opened.length}`,
    };
  }
}

describe("epic merge mode (AI-216)", () => {
  let tracker: InMemoryWorkTracker;
  let runs: InMemoryRunStore;
  let host: EpicHost;
  let nights: InMemoryNightLaunchStore;
  let tickets: TicketService;
  let epicMode: EpicMode;
  let projectId: string;
  let epic: Ticket;
  let prNumber: number;
  const ms = Date.parse("2026-11-24T10:00:00.000Z");
  const now = () => new Date(ms);

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    prNumber = 40;
    tracker = new InMemoryWorkTracker();
    runs = new InMemoryRunStore(now);
    host = new EpicHost([REPO]);
    host.requiredChecks = REQUIRED.map((name) => ({ name, sourceId: "15368" }));
    host.branches.set(`${REPO.fullName.toLowerCase()}#main`, MAIN_TIP);
    nights = new InMemoryNightLaunchStore();
    tickets = new TicketService(tracker, null, null, now);
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await setMode("epic");
    epic = await tracker.createTicket(projectId, { type: "epic", title: "Epic work" }, "andy");
    epicMode = new EpicMode(tracker, runs, host, APP_URL, nights);
  });

  const gate = () =>
    new PullRequestGate(
      host,
      tracker,
      runs,
      tickets,
      now,
      null,
      new EpicMerges(null, runs, epicMode),
    );

  async function setMode(mergeMode: MergeMode | null) {
    await tracker.updateProject(projectId, { mergeMode });
  }

  async function child(title: string, parentId: string | null = epic.id): Promise<Ticket> {
    const t = await tracker.createTicket(projectId, { type: "feature", title, parentId }, "andy");
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready_for_review", forced: true, reason: null } },
      "andy",
    );
  }

  /** A succeeded build run of `ticket` whose PR (open, all checks green) targets `baseRef`. */
  async function agentPr(
    ticket: Ticket,
    baseRef = `epic/${epic.key}`,
  ): Promise<{ run: Run; pr: PullRequest }> {
    const number = ++prNumber;
    const intoDefault = baseRef === "main";
    const created = await runs.create({
      projectId,
      ticketId: ticket.id,
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: "fast",
      deadline: null,
      baseBranch: (intoDefault ? null : baseRef) as Run["baseBranch"],
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
      labels: [],
    };
    host.pullRequests.set(number, {
      pullRequest: pr,
      files: { items: [{ path: "apps/web/src/a.tsx", previousPath: null }], complete: true },
      checks: { items: REQUIRED.map(passed), complete: true },
      commits: { items: [], complete: true },
    });
    return { run, pr };
  }

  const opened = (pr: PullRequest) => ({
    kind: "pull_request" as const,
    deliveryId: `d-${pr.number}`,
    projectId,
    repo: REPO.fullName,
    action: "opened",
    receivedAt: now().toISOString(),
    pullRequest: pr,
  });
  const project = async () => (await tracker.getProject(projectId))!;
  const stageOf = async (t: Ticket) => (await tracker.getTicket(projectId, t.id))!.stage;

  describe("merging a child ticket into the epic branch", () => {
    it("GivenEpicModeAndACleanChildTicketPr_WhenTheGateAssessesIt_ThenItMergesIntoTheEpicBranchAndTheTicketIsDone", async () => {
      const a = await child("A");
      await child("B");
      const { run, pr } = await agentPr(a);

      const [result] = await gate().apply(opened(pr), await project());

      expect(result).toMatchObject({ result: "merged", pr: pr.number });
      expect(host.merges).toEqual([
        { fullName: REPO.fullName, number: pr.number, sha: pr.headSha },
      ]);
      expect((await runs.get(run.id))!.epicMerge).toEqual({
        at: now().toISOString(),
        sha: expect.any(String),
      });
      expect(await stageOf(a)).toBe("done");
      // B is still open: no epic PR yet.
      expect(host.opened).toEqual([]);
    });

    it("GivenAnotherMode_WhenAChildTicketPrTargetsTheEpicBranch_ThenItDoesNotMerge", async () => {
      await setMode("all-clean");
      const a = await child("A");
      const { pr } = await agentPr(a);

      const [result] = await gate().apply(opened(pr), await project());

      expect(result).toMatchObject({ result: "assessed" });
      expect(host.merges).toEqual([]);
    });

    it("GivenAPrIntoAnotherEpicsBranch_WhenAssessed_ThenItDoesNotMerge", async () => {
      const other = await tracker.createTicket(projectId, { type: "epic", title: "Other" }, "andy");
      const a = await child("A");
      const { pr } = await agentPr(a, `epic/${other.key}`);

      await gate().apply(opened(pr), await project());

      expect(host.merges).toEqual([]);
    });

    it("GivenAChildTicketThatAlreadyMergedOnce_WhenANewPrTargetsTheEpicBranch_ThenItDoesNotMergeAgain", async () => {
      const a = await child("A");
      const first = await agentPr(a);
      await runs.update(first.run.id, { mergeAttemptedSha: first.pr.headSha }, ["succeeded"]);
      const second = await agentPr(a);

      expect(await epicMode.target(second.pr, second.run, a)).toBeNull();
    });

    it("GivenAnEpicOverTheChildTicketBound_WhenAChildTicketPrIsClean_ThenNothingMerges", async () => {
      const a = await child("A");
      for (let i = 0; i < MAX_EPIC_CHILDREN; i++) {
        await tracker.createTicket(
          projectId,
          { type: "feature", title: `c${i}`, parentId: epic.id },
          "andy",
        );
      }
      const { pr } = await agentPr(a);

      await gate().apply(opened(pr), await project());

      expect(host.merges).toEqual([]);
    });
  });

  describe("the epic PR for Andy", () => {
    it("GivenTwoChildTickets_WhenTheLastOneMergesIntoTheEpicBranch_ThenExactlyOneEpicPrOpensAndNothingMergesIntoMain", async () => {
      const a = await child("A");
      const b = await child("B");
      const prA = (await agentPr(a)).pr;
      const prB = (await agentPr(b)).pr;

      await gate().apply(opened(prA), await project());
      await gate().apply(opened(prB), await project());

      expect(await stageOf(b)).toBe("done");
      expect(host.opened).toHaveLength(1);
      const [epicPr] = host.opened;
      expect(epicPr).toMatchObject({
        head: `epic/${epic.key}`,
        base: "main",
        title: `${epic.key}: Epic work`,
      });
      expect(epicPr!.body.split("\n")[0]).toBe(`${APP_URL}/p/ai/t/${epic.key}`);
      expect(epicPr!.body).toContain(`| ${a.key} | ${prA.url} |`);
      expect(epicPr!.body).toContain(`| ${b.key} | ${prB.url} |`);
      expect(epicPr!.body).toContain("Andy merges it");
      // Only the two child tickets merged, both into the epic branch.
      expect(host.merges.map((m) => m.number)).toEqual([prA.number, prB.number]);
    });

    it("GivenTheEpicPrIsOpen_WhenAskedAgain_ThenItIsNotOpenedTwice", async () => {
      const a = await child("A");
      await gate().apply(opened((await agentPr(a)).pr), await project());

      expect(await epicMode.openWhenDone(projectId, a)).toMatchObject({ result: "exists" });
      expect(host.opened).toHaveLength(1);
    });

    it("GivenACancelledChildTicket_WhenTheOthersAreDone_ThenTheEpicPrOpens", async () => {
      const a = await child("A");
      const c = await child("C");
      await tracker.updateTicket(
        projectId,
        c.id,
        { stage: { to: "cancelled", forced: true, reason: null } },
        "andy",
      );
      await gate().apply(opened((await agentPr(a)).pr), await project());

      expect(host.opened).toHaveLength(1);
    });

    it("GivenAnActiveNightLaunchOfTheEpic_WhenItsLastChildTicketIsDone_ThenTheMorningPrIsLeftToTheLaunch", async () => {
      const a = await child("A");
      await nights.create({
        id: "launch-1",
        projectId,
        epicId: epic.id,
        epicKey: epic.key,
        budget: { maxRuns: 10, maxTokens: 1_000_000, maxUsd: 50 },
        stopAt: new Date(ms + 3_600_000).toISOString(),
        status: "running",
        storyKeys: [],
        createdAt: now().toISOString(),
        createdBy: "user:andy",
        startedAt: now().toISOString(),
        endedAt: null,
        endReason: null,
        epicBranch: null,
        stoppedStories: [],
      });
      await tracker.updateTicket(
        projectId,
        a.id,
        { stage: { to: "done", forced: true, reason: null } },
        "andy",
      );

      expect(await epicMode.openWhenDone(projectId, a)).toEqual({
        result: "skipped",
        reason: "night_launch",
      });
    });
  });

  describe("a ticket with no epic", () => {
    it("GivenEpicModeAndATicketWithNoEpic_WhenItsCleanPrTargetsMain_ThenItWaitsForAndy", async () => {
      const lone = await child("Lone", null);
      const { pr, run } = await agentPr(lone, "main");

      const [result] = await gate().apply(opened(pr), await project());

      expect(result).toMatchObject({ result: "assessed" });
      expect(host.merges).toEqual([]);
      const after = (await runs.get(run.id))!;
      expect(after.mergeMode).toBe("epic");
      expect(after.verdictReasons).toEqual(["mode_epic"]);
      expect(await epicMode.baseBranch(projectId, lone)).toBeNull();
    });

    it("GivenEpicMode_WhenTheVerdictJudgesAPrIntoMain_ThenItWaitsWithModeEpic", () => {
      const verdict = mergeVerdict(
        {
          gateClean: true,
          files: { items: [], complete: true },
          labels: [],
          upToDate: true,
          openFindings: 0,
          readyForReview: true,
        },
        "epic",
      );
      expect(verdict).toMatchObject({ verdict: "wait", reasons: ["mode_epic"] });
    });
  });

  describe("the build's base branch", () => {
    it("GivenEpicModeAndNoEpicBranchYet_WhenAChildTicketBuilds_ThenTheBranchIsMadeFromMainsTip", async () => {
      const a = await child("A");

      expect(await epicMode.baseBranch(projectId, a)).toBe(`epic/${epic.key}`);
      expect(host.created).toEqual([{ branch: `epic/${epic.key}`, sha: MAIN_TIP }]);
      // The second child ticket reuses it.
      const b = await child("B");
      expect(await epicMode.baseBranch(projectId, b)).toBe(`epic/${epic.key}`);
      expect(host.created).toHaveLength(1);
    });

    it("GivenAnotherMode_WhenAChildTicketBuilds_ThenItBuildsOnTheDefaultBranch", async () => {
      await setMode("low-risk");
      const a = await child("A");

      expect(await epicMode.baseBranch(projectId, a)).toBeNull();
      expect(host.created).toEqual([]);
    });

    it("GivenAProjectInLowRiskAndAnEpicOverrideOfEpic_WhenAChildTicketBuilds_ThenItUsesTheEpicBranch", async () => {
      await setMode("low-risk");
      await tracker.updateTicket(
        projectId,
        epic.id,
        { fields: { overrides: { mergeMode: "epic" } } },
        "andy",
      );
      const a = await child("A");

      expect(await epicMode.baseBranch(projectId, a)).toBe(`epic/${epic.key}`);
    });
  });

  describe("epicPrTitle and epicPrBody", () => {
    it("GivenAnEpicTitleWithAMention_WhenTitled_ThenTheMentionIsDropped", () => {
      expect(epicPrTitle("AI-1", "Ping @someone\nnow")).toBe("AI-1: Ping someone now");
    });

    it("GivenMergedChildTickets_WhenDescribed_ThenTheEpicLinkComesFirstAndEachChildIsListed", () => {
      const body = epicPrBody("https://x/p/ai/t/AI-1", "epic/AI-1", [
        { key: "AI-2", pullRequest: "https://g/pull/2", at: "t", sha: null },
      ]);
      expect(body.split("\n")[0]).toBe("https://x/p/ai/t/AI-1");
      expect(body).toContain("| AI-2 | https://g/pull/2 |");
    });
  });
});
