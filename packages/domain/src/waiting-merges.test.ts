import {
  InMemoryRunStore,
  type CodeHost,
  InMemoryWorkTracker,
  WAITING_MERGES_MAX,
  type MergeWaitReason,
  type RunPatch,
  type Ticket,
  emptyMergeQueue,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { MergeQueue } from "./merge-queue";
import { WaitingMergesReader, pullRequestRef, waitingRun } from "./waiting-merges";

/** AI-218: "Waiting for your merge", read from the gate's verdict on each build. */

const REPO_URL = "https://github.com/albernhagen/andy-intelligence";
const BODY = [
  "Fixes the board.",
  "",
  "What changed: The board shows lanes.",
  "How it works: It reads tickets once.",
  "Needs you: Turn it on.",
].join("\n");

describe("waiting merges", () => {
  let clock: number;
  let tracker: InMemoryWorkTracker;
  let runs: InMemoryRunStore;
  let details: Mock<CodeHost["getPullRequestDetails"]>;
  let reader: WaitingMergesReader;

  beforeEach(async () => {
    clock = Date.parse("2026-11-22T10:00:00.000Z");
    const now = () => new Date(clock);
    tracker = new InMemoryWorkTracker(now);
    runs = new InMemoryRunStore(now);
    details = vi.fn<CodeHost["getPullRequestDetails"]>(async () => ({
      body: BODY,
      mergedBy: null,
      mergedAt: null,
    }));
    reader = new WaitingMergesReader(
      tracker,
      runs,
      { getPullRequestDetails: details },
      undefined,
      now,
    );
    await tracker.createProject({ name: "AI", key: "AI", repos: [] });
  });

  /** A ticket in review whose build's PR got this verdict from the gate. */
  async function inReview(
    title: string,
    reasons: MergeWaitReason[],
    patch: RunPatch = {},
    projectId = "ai",
  ): Promise<Ticket> {
    const t = await tracker.createTicket(projectId, { title, type: "chore" }, "andy");
    await tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready_for_review", forced: true, reason: null } },
      "andy",
    );
    const run = await runs.create({
      projectId,
      ticketId: t.id,
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "opus" },
      tier: null,
      deadline: null,
      prompt: null,
      maxTurns: null,
    });
    await runs.update(
      run.id,
      {
        status: "succeeded",
        links: { pullRequest: `${REPO_URL}/pull/${t.key.split("-")[1]}` },
        mergeMode: "low-risk",
        mergeVerdict: "wait",
        verdictReasons: reasons,
        ...patch,
      },
      ["queued"],
    );
    return (await tracker.getTicket(projectId, t.id))!;
  }

  it("GivenACleanPrLeftByTheMode_WhenRead_ThenItIsListedWithWhyAndItsReleaseNote", async () => {
    const t = await inReview("Lanes", ["high_risk_path"]);

    const { merges, truncated } = await reader.read();

    expect(truncated).toBe(false);
    expect(merges).toEqual([
      {
        projectId: "ai",
        ticketKey: t.key,
        ticketTitle: "Lanes",
        prNumber: 1,
        prUrl: `${REPO_URL}/pull/1`,
        mergeMode: "low-risk",
        reasons: ["high_risk_path"],
        note: {
          whatChanged: "The board shows lanes.",
          howItWorks: "It reads tickets once.",
          needsYou: "Turn it on.",
        },
        queue: null,
      },
    ]);
    expect(details).toHaveBeenCalledWith("albernhagen/andy-intelligence", 1);
  });

  it("GivenAPrInItsRepoMergeQueue_WhenRead_ThenItShowsItsPlaceAndWhatTheQueueWaitsFor", async () => {
    await inReview("Queued", ["kept_path"]);
    await inReview("Not queued", ["kept_path"]);
    const entry = (number: number, lastNote: string | null) => ({
      projectId: "ai",
      number,
      kind: "merge_pr" as const,
      enqueuedAt: "2026-11-22T10:00:00.000Z",
      enqueuedBy: "user:andy",
      headSha: "a".repeat(40),
      syncs: 0,
      syncRequestedSha: null,
      judgedSince: null,
      approval: "owner" as const,
      approvedDiff: "d",
      lastNote,
    });
    const state = vi.fn(async (repo: string) => ({
      ...emptyMergeQueue(repo),
      entries: [entry(9, null), entry(1, "sync requested")],
    }));
    const queued = new WaitingMergesReader(tracker, runs, null, undefined, () => new Date(clock), {
      state,
    } as unknown as Pick<MergeQueue, "state">);

    const { merges } = await queued.read();

    expect(merges.map((m) => [m.prNumber, m.queue])).toEqual([
      [1, { position: 2, note: "sync requested" }],
      [2, null],
    ]);
    // One read per repo, however many of its PRs are listed.
    expect(state).toHaveBeenCalledTimes(1);
  });

  it("GivenTheQueueReadFails_WhenRead_ThenThePrIsStillListedWithNoQueue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await inReview("Queued", ["kept_path"]);
    const failing = new WaitingMergesReader(tracker, runs, null, undefined, () => new Date(clock), {
      state: async () => Promise.reject(new Error("store down")),
    } as unknown as Pick<MergeQueue, "state">);

    expect((await failing.read()).merges.map((m) => m.queue)).toEqual([null]);
  });

  it("GivenPrsThatAreNotJustAndys_WhenRead_ThenOnlyTheOnesWaitingOnHisMergeAreListed", async () => {
    await inReview("Andy's", ["kept_path", "mode_manual"]);
    await inReview("Failing", ["kept_path", "gate_not_clean"]);
    await inReview("Behind", ["behind_default_branch"]);
    await inReview("Merging", [], { mergeVerdict: "merge" });
    await inReview("Merged", ["kept_path"], { outcome: "merged_clean" });

    const { merges } = await reader.read();

    expect(merges.map((m) => m.ticketTitle)).toEqual(["Andy's"]);
  });

  it("GivenAListedPr_WhenAndyMergesIt_ThenItLeavesTheList", async () => {
    const t = await inReview("Lanes", ["accepted_label"]);
    expect((await reader.read()).merges).toHaveLength(1);

    // The merge webhook moves the ticket to Done and sets the agent task's outcome.
    await tracker.updateTicket(
      "ai",
      t.id,
      { stage: { to: "done", forced: true, reason: null } },
      "andy",
    );

    expect((await reader.read()).merges).toEqual([]);
  });

  it("GivenTwoWaitingPrs_WhenRead_ThenTheyComeInTheBoardsOrder", async () => {
    const first = await inReview("First", ["mode_not_set"]);
    const second = await inReview("Second", ["mode_not_set"]);
    await tracker.updateTicket(
      "ai",
      second.id,
      { fields: { rank: `${first.rank.slice(0, -1)}0` } },
      "andy",
    );

    const { merges } = await reader.read();

    expect(merges.map((m) => m.ticketTitle)).toEqual(["Second", "First"]);
  });

  it("GivenTheSameListReadTwice_WhenWithinFiveMinutes_ThenTheDescriptionIsReadOnce", async () => {
    await inReview("Lanes", ["kept_path"]);
    await reader.read();
    await reader.read();
    expect(details).toHaveBeenCalledTimes(1);

    clock += 5 * 60_000;
    await reader.read();
    expect(details).toHaveBeenCalledTimes(2);
  });

  it("GivenTheDescriptionReadFails_WhenRead_ThenThePrIsListedWithoutANote", async () => {
    details.mockRejectedValueOnce(new Error("rate limited"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await inReview("Lanes", ["kept_path"]);

    const { merges } = await reader.read();

    expect(merges[0]?.note).toBeNull();
  });

  it("GivenTwoProjects_WhenOneIsAskedFor_ThenOnlyItsPrsAreListed", async () => {
    await tracker.createProject({ name: "Ops", key: "OPS", repos: [] });
    await inReview("AI one", ["kept_path"]);
    await inReview("Ops one", ["kept_path"], {}, "ops");

    expect((await reader.read("ops")).merges.map((m) => m.ticketTitle)).toEqual(["Ops one"]);
    expect((await reader.read()).merges).toHaveLength(2);
  });

  it("GivenMoreTicketsInReviewThanTheCap_WhenRead_ThenItSaysSomeMayBeMissing", async () => {
    for (let i = 0; i <= WAITING_MERGES_MAX; i++) await inReview(`T${i}`, ["kept_path"]);

    const result = await reader.read();

    expect(result.merges).toHaveLength(WAITING_MERGES_MAX);
    expect(result.truncated).toBe(true);
  });

  it("GivenRunsNewestFirst_WhenPicked_ThenOnlyTheLatestBuildPrCounts", () => {
    const run = (over: object) =>
      ({
        step: "build",
        links: { pullRequest: `${REPO_URL}/pull/1` },
        outcome: null,
        mergeVerdict: "wait",
        verdictReasons: ["kept_path"],
        ...over,
      }) as never;
    expect(waitingRun([run({})])).not.toBeNull();
    expect(waitingRun([run({ step: "refine" }), run({})])).not.toBeNull();
    expect(waitingRun([run({ outcome: "reworked" }), run({})])).toBeNull();
    expect(waitingRun([run({ verdictReasons: [] })])).toBeNull();
    expect(waitingRun([])).toBeNull();
  });

  it("GivenPrUrls_WhenParsed_ThenTheRepoAndNumberComeOut", () => {
    expect(pullRequestRef(`${REPO_URL}/pull/42`)).toEqual({
      repo: "albernhagen/andy-intelligence",
      number: 42,
    });
    expect(pullRequestRef("https://example.com/x")).toBeNull();
  });
});
