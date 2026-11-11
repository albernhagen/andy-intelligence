import { describe, expect, it } from "vitest";
import type { Run, Ticket, TicketEvent } from "@andy/contracts";
import {
  latestPullRequest,
  openBlockerKeys as openBlockers,
  queuePosition,
  statusLine,
  type StatusInput,
  syncStopped,
  syncWaiting,
} from "./status-line";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const base: StatusInput = {
  stage: "backlog",
  archived: false,
  needsAttention: false,
  dorMet: false,
  openQuestions: 0,
  run: null,
  pr: null,
  blockedBy: [],
  queuePosition: null,
};
const line = (s: Partial<StatusInput>) => statusLine({ ...base, ...s }, NOW);

describe("statusLine", () => {
  it("GivenASyncThatStopped_WhenTheTicketWaitsForAndy_ThenTheLineSaysWhyAndWhere", () => {
    expect(
      line({ needsAttention: true, syncStopped: "sync with main stopped on a conflict in a.ts" }),
    ).toEqual({
      text: "Waiting for you: sync with main stopped on a conflict in a.ts",
      tone: "attention",
    });
  });

  it("GivenOpenQuestions_WhenComputed_ThenItWaitsForAndy", () => {
    expect(line({ openQuestions: 2, needsAttention: true })).toEqual({
      text: "Waiting for you: 2 questions",
      tone: "attention",
    });
    expect(line({ openQuestions: 1 }).text).toBe("Waiting for you: 1 question");
  });

  it("GivenOpenQuestionsAndAQuestionLine_WhenComputed_ThenTheLineShowsTheQuestionNotACount", () => {
    const q = "Which layout should the board use?";
    expect(line({ openQuestions: 1, questionLine: q })).toEqual({
      text: `Waiting for you: ${q}`,
      tone: "attention",
    });
    expect(line({ openQuestions: 3, questionLine: q }).text).toBe(
      `Waiting for you: ${q} (and 2 more questions)`,
    );
    expect(line({ openQuestions: 2, questionLine: "x".repeat(250) }).text).toBe(
      `Waiting for you: ${"x".repeat(200)}… (and 1 more question)`,
    );
  });

  // AI-73 review: the question line replaces only the open-question line, never another reason.
  it.each<[string, Partial<StatusInput>, string]>([
    ["a flag", { needsAttention: true }, "Waiting for you"],
    [
      "a stopped sync",
      { needsAttention: true, syncStopped: "sync with main stopped" },
      "Waiting for you: sync with main stopped",
    ],
    ["a ticket of Andy's", { stage: "ready", worker: "me" }, "Mine · waiting on you"],
    ["a ticket with no worker", { stage: "ready", worker: "ask" }, "Needs a worker"],
    ["a done ticket with questions", { stage: "done", openQuestions: 1 }, "Done"],
  ])("GivenAQuestionLineAnd%s_WhenComputed_ThenThatLineIsKept", (_, over, text) => {
    expect(line({ ...over, questionLine: "Which layout should the board use?" }).text).toBe(text);
  });

  it("GivenNeedsAttentionWithoutQuestions_WhenComputed_ThenItWaitsForAndy", () => {
    expect(line({ needsAttention: true })).toEqual({ text: "Waiting for you", tone: "attention" });
  });

  it("GivenARefineRunStartedAMinuteAgo_WhenComputed_ThenItSaysRefiningOneMin", () => {
    const run = {
      id: "r",
      step: "refine",
      status: "running",
      startedAt: minutesAgo(1),
      createdAt: null,
    };
    expect(line({ run } as Partial<StatusInput>)).toEqual({
      text: "Refining · 1 min",
      tone: "running",
    });
  });

  it("GivenABuildRunWithAnOpenPr_WhenComputed_ThenItShowsStepTimeAndPr", () => {
    const run = {
      id: "r",
      step: "build",
      status: "running",
      startedAt: minutesAgo(12),
      createdAt: minutesAgo(13),
    } as const;
    expect(line({ stage: "in_progress", run, pr: { number: 61, state: "open" } }).text).toBe(
      "Building · 12 min · PR #61 open",
    );
  });

  it("GivenAQueuedRun_WhenComputed_ThenItSaysQueuedLikeTheCard", () => {
    const run = {
      id: "r",
      step: "refine",
      status: "queued",
      startedAt: null,
      createdAt: minutesAgo(3),
    } as const;
    // The board card's words (`runLabel`).
    expect(line({ run }).text).toBe("Refine queued · 3 min");
  });

  it("GivenOpenBlockers_WhenComputed_ThenItNamesThem", () => {
    expect(line({ stage: "ready", blockedBy: ["AI-3"] })).toEqual({
      text: "Blocked by AI-3",
      tone: "danger",
    });
    expect(line({ blockedBy: ["AI-3", "AI-4", "AI-5"] }).text).toBe(
      "Blocked by AI-3, AI-4 and AI-5",
    );
  });

  it("GivenTheTopOfTheReadyLane_WhenComputed_ThenItIsNextInTheQueue", () => {
    expect(line({ stage: "ready", queuePosition: 1 }).text).toBe("Ready · next in the queue");
    expect(line({ stage: "ready", queuePosition: 2 }).text).toBe("Ready · 2nd in the queue");
    expect(line({ stage: "ready", queuePosition: 13 }).text).toBe("Ready · 13th in the queue");
    expect(line({ stage: "ready", queuePosition: null }).text).toBe("Ready");
  });

  it("GivenAReadyTicketOverlappingARunInFlight_WhenComputed_ThenItSaysWhichOne", () => {
    expect(line({ stage: "ready", queuePosition: 1, overlaps: "AI-12" }).text).toBe(
      "Waiting: overlaps AI-12 in flight",
    );
  });

  it("GivenBacklog_WhenComputed_ThenItSaysWhetherItIsReadyToMove", () => {
    expect(line({}).text).toBe("Backlog · needs refining");
    expect(line({ dorMet: true }).text).toBe("Backlog · ready to move to Ready");
  });

  it("GivenInProgressWithoutARun_WhenComputed_ThenItSaysSo", () => {
    expect(line({ stage: "in_progress" }).text).toBe("In progress · no run in flight");
    expect(line({ stage: "in_progress", pr: { number: 7, state: "open" } }).text).toBe(
      "In progress · PR #7 open",
    );
  });

  it("GivenLaterStages_WhenComputed_ThenThePrStateIsShown", () => {
    expect(line({ stage: "ready_for_review", pr: { number: 12, state: "open" } }).text).toBe(
      "Ready for review · PR #12 open",
    );
    expect(line({ stage: "done", pr: { number: 12, state: "merged" } })).toEqual({
      text: "Done · PR #12 merged",
      tone: "success",
    });
  });

  it("GivenCancelledOrDone_WhenQuestionsAreOpen_ThenTheStageWins", () => {
    expect(line({ stage: "cancelled", openQuestions: 1 }).text).toBe("Cancelled");
    expect(line({ stage: "done", openQuestions: 1 })).toEqual({ text: "Done", tone: "success" });
  });

  it("GivenAnArchivedTicket_WhenComputed_ThenArchivedIsAppended", () => {
    expect(line({ stage: "done", archived: true }).text).toBe("Done · archived");
  });

  it("GivenQuestionsAndARun_WhenComputed_ThenQuestionsComeFirst", () => {
    const run = {
      id: "r",
      step: "refine",
      status: "running",
      startedAt: minutesAgo(5),
      createdAt: null,
    } as const;
    expect(line({ openQuestions: 1, run, blockedBy: ["AI-3"] }).text).toBe(
      "Waiting for you: 1 question",
    );
    expect(line({ run, blockedBy: ["AI-3"] }).text).toBe("Refining · 5 min");
  });
});

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "t",
  projectId: "ai",
  key: "AI-1",
  type: "feature",
  parentId: null,
  title: "T",
  body: "",
  acceptanceCriteria: [],
  assumptions: [],
  stage: "backlog",
  rank: "0001",
  size: null,
  sizeReason: null,
  overrides: {},
  needsAttention: false,
  dorStatus: "not_met",
  blockedBy: [],
  archived: false,
  upNextRank: null,
  upNextAt: null,
  sentBackReason: null,
  refineAssumptions: [],
  outOfScope: [],
  touches: [],
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  risk: null,
  riskReason: null,
  confidence: null,
  confidenceReason: null,
  ...over,
});

describe("status inputs", () => {
  it("GivenPrEvents_WhenRead_ThenTheLatestPrIsUsed", () => {
    const pr = (number: number, state: string): TicketEvent => ({
      id: `e${number}`,
      ticketId: "t",
      kind: "pr_linked",
      actor: "system",
      runId: null,
      body: null,
      data: { number, state, url: "https://github.com/a/b/pull/1" },
      createdAt: NOW.toISOString(),
    });
    expect(latestPullRequest([])).toBeNull();
    expect(latestPullRequest([pr(1, "closed"), pr(2, "open")])).toEqual({
      number: 2,
      state: "open",
    });
    expect(latestPullRequest([pr(3, "weird")])).toBeNull();
  });

  it("GivenBlockers_WhenRead_ThenOnlyUnfinishedOnesAreNamed", () => {
    const open = ticket({ id: "b1", key: "AI-3", stage: "in_progress" });
    const done = ticket({ id: "b2", key: "AI-4", stage: "done" });
    const t = ticket({ blockedBy: ["b1", "b2", "elsewhere"] });
    // As on the board: a blocker outside this project's tickets isn't counted.
    expect(openBlockers(t, [open, done, t])).toEqual(["AI-3"]);
  });

  it("GivenTheReadyLane_WhenRead_ThenThePositionFollowsRank", () => {
    const a = ticket({ id: "a", stage: "ready", rank: "0002" });
    const b = ticket({ id: "b", stage: "ready", rank: "0001" });
    const archived = ticket({ id: "c", stage: "ready", rank: "0000", archived: true });
    expect(queuePosition(a, [a, b, archived])).toBe(2);
    expect(queuePosition(b, [a, b, archived])).toBe(1);
    expect(queuePosition(ticket({}), [a, b])).toBeNull();
  });

  it("GivenABlockedTicketFirstInReady_WhenRead_ThenTheNextUnblockedOneIsFirstLikeTheBoardsNext", () => {
    const blocker = ticket({ id: "x", stage: "in_progress" });
    const blocked = ticket({ id: "a", stage: "ready", rank: "0001", blockedBy: ["x"] });
    const free = ticket({ id: "b", stage: "ready", rank: "0002" });
    const all = [blocker, blocked, free];
    expect(queuePosition(free, all)).toBe(1);
    expect(queuePosition(blocked, all)).toBeNull();
  });
});

describe("syncStopped", () => {
  const sync = (outcome: string, buildRunId = "b1", files = ["a.ts", "b.ts", "c.ts", "d.ts"]) =>
    ({ step: "sync", syncRun: { outcome, buildRunId, conflictFiles: files } }) as unknown as Run;
  const build = (id: string) => ({ step: "build", id }) as unknown as Run;

  it("GivenTheNewestSyncStopped_WhenRead_ThenItNamesTheOutcomeAndUpToThreeFiles", () => {
    expect(syncStopped([sync("conflict_unresolved"), build("b1")])).toBe(
      "sync with main stopped on a conflict in a.ts, b.ts, c.ts, …",
    );
    expect(syncStopped([sync("checks_failed", "b1", []), build("b1")])).toBe(
      "sync with main stopped: checks failed after the merge",
    );
  });

  it("GivenASyncedRunOrAStopOnAnOlderPr_WhenRead_ThenNull", () => {
    expect(syncStopped([sync("synced"), build("b1")])).toBeNull();
    expect(syncStopped([build("b2"), sync("conflict_unresolved", "b1")])).toBeNull();
    expect(syncStopped([])).toBeNull();
  });
});

describe("syncWaiting", () => {
  const build = (prSync: object | null) =>
    ({
      step: "build",
      id: "b1",
      links: { pullRequest: "https://github.com/a/b/pull/7" },
      prSync,
    }) as unknown as Run;

  it("GivenAPendingSyncThatWaits_WhenRead_ThenItSaysWhyAndTheReviewLineShowsIt", () => {
    const runs = [build({ pendingSince: "2026-11-10T00:00:00Z", waiting: "paused" })];
    expect(syncWaiting(runs)).toBe("dispatch is paused");
    // Unchecked and builds-off waits hold no veto (no pendingSince) but still show.
    expect(syncWaiting([build({ pendingSince: null, waiting: "pr_cap" })])).toBe(
      "not checked yet (more open PRs than one check covers); next in line",
    );
    expect(syncWaiting([build({ pendingSince: null, waiting: "builds_off" })])).toBe(
      "builds are off, so no sync runs",
    );
    expect(syncWaiting([build({ pendingSince: null, waiting: "global_cap" })])).toBeNull();
    expect(syncWaiting([build({ pendingSince: null, waiting: null })])).toBeNull();
    expect(line({ stage: "ready_for_review", syncWaiting: "dispatch is paused" }).text).toBe(
      "Ready for review · sync with main waits: dispatch is paused",
    );
  });
});
