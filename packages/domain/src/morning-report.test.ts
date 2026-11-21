import {
  InMemoryWorkTracker,
  NightLaunch,
  type ReviewFinding,
  type Run,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MorningReports,
  MorningSteps,
  REPORT_QUOTE_MAX,
  morningReport,
  quoteUntrusted,
  reportMarker,
  storyReport,
} from "./morning-report";
import type { MorningResult } from "./night-merge";

const REPO = "https://github.com/albernhagen/andy-intelligence";
const START = "2026-11-20T22:00:00.000Z";

const baseLaunch = (over: Partial<NightLaunch> = {}): NightLaunch =>
  NightLaunch.parse({
    id: "launch-1",
    projectId: "ai",
    epicId: "epic-id",
    epicKey: "AI-1",
    budget: { maxRuns: 10, maxTokens: 1_000_000, maxUsd: 20 },
    stopAt: "2026-11-21T06:00:00.000Z",
    status: "ended",
    storyKeys: ["AI-2", "AI-3", "AI-4", "AI-5"],
    createdAt: START,
    createdBy: "user:andy",
    startedAt: START,
    endedAt: "2026-11-21T06:00:00.000Z",
    endReason: "stop_time",
    epicBranch: { name: "epic/AI-1", sha: "a".repeat(40) },
    stoppedStories: [
      {
        key: "AI-3",
        reason: "build failed twice: tests [red](http://x)",
        at: START,
        skipped: ["AI-4"],
      },
    ],
    ...over,
  });

const run = (over: Partial<Run>): Run =>
  ({
    id: "r1",
    ticketId: "t2",
    step: "build",
    status: "succeeded",
    createdAt: "2026-11-20T23:00:00.000Z",
    endedAt: "2026-11-20T23:30:00.000Z",
    costUsd: 1.25,
    tokensIn: 200_000,
    tokensOut: 50_000,
    baseBranch: "epic/AI-1",
    links: { pullRequest: `${REPO}/pull/61` },
    epicMerge: { at: "2026-11-20T23:40:00.000Z", sha: "b".repeat(40) },
    verification: [
      { command: "pnpm test", passed: true, output: "ok" },
      { command: "pnpm lint", passed: true, output: "ok" },
    ],
    ...over,
  }) as Run;

const ticket = (key: string, over: Partial<Ticket> = {}): Ticket =>
  ({
    id: `t${key.split("-")[1]}`,
    key,
    stage: "in_progress",
    refineAssumptions: [],
    ...over,
  }) as Ticket;

const finding = (
  pullNumber: number,
  severity: ReviewFinding["severity"],
  repo = "albernhagen/andy-intelligence",
): ReviewFinding => ({ pullNumber, severity, repo }) as ReviewFinding;

describe("storyReport", () => {
  it("GivenAMergedStory_WhenReported_ThenItHasItsPrChecksFindingsAndCost", () => {
    const s = storyReport(
      baseLaunch(),
      ticket("AI-2", {
        refineAssumptions: [
          { text: "Use the existing chip", nightLaunchId: "launch-1" },
          { text: "From another night", nightLaunchId: "launch-0" },
        ] as Ticket["refineAssumptions"],
      }),
      [run({}), run({ id: "old", createdAt: "2026-11-19T10:00:00.000Z", costUsd: 9 })],
      [
        finding(61, "should-fix"),
        finding(61, "question"),
        finding(62, "blocker"),
        // Same number in another repo of the project: not this story's PR.
        finding(61, "critical", "albernhagen/other"),
      ],
      new Set(["AI-2"]),
    );

    expect(s).toEqual({
      key: "AI-2",
      result: "merged",
      reason: null,
      pullRequest: { number: 61, url: `${REPO}/pull/61` },
      checks: { passed: 2, total: 2 },
      findings: { "should-fix": 1, question: 1 },
      assumptions: ["Use the existing chip"],
      usd: 1.25,
      tokens: 250_000,
      unknownCost: 0,
    });
  });

  it("GivenStoppedSkippedAndUntouchedStories_WhenReported_ThenEachSaysWhy", () => {
    const launch = baseLaunch();
    const none = new Set<string>();
    const stopped = storyReport(launch, ticket("AI-3"), [run({ ticketId: "t3" })], [], none);
    const skipped = storyReport(launch, ticket("AI-4"), [], [], none);
    const untouched = storyReport(launch, ticket("AI-5"), [], [], none);

    expect(stopped.result).toBe("stopped");
    expect(stopped.reason).toContain("build failed twice");
    expect(skipped).toMatchObject({ result: "skipped", reason: "waits on AI-3, which stopped" });
    expect(untouched).toMatchObject({
      result: "not_started",
      reason: expect.stringContaining("no agent task"),
    });
  });

  it("GivenAFinishedRunWithNoUsage_WhenReported_ThenItsCostIsUnknownNotZero", () => {
    const s = storyReport(
      baseLaunch(),
      ticket("AI-5"),
      [run({ costUsd: null, ticketId: "t5", epicMerge: null })],
      [],
      new Set(),
    );
    expect(s).toMatchObject({ result: "unfinished", usd: 0, unknownCost: 1 });
  });
});

describe("quoteUntrusted", () => {
  it("GivenMarkupLinksAndLineBreaks_WhenQuoted_ThenNoneSurvive", () => {
    expect(quoteUntrusted("Use **bold** [x](http://e.vil)\n<img> @andy `code`")).toBe(
      "“Use \\*\\*bold\\*\\* \\[x\\]\\(http:/\u200b/e.vil\\) \\<img\\> \\@andy \\`code\\`”",
    );
  });

  it("GivenBareUrlsAndEntities_WhenQuoted_ThenNoAutolinkOrEntitySurvives", () => {
    const q = quoteUntrusted("see https://e.vil/x and www.e.vil &amp; Www.X.com");
    expect(q).not.toMatch(/https?:\/\//);
    expect(q).not.toMatch(/www\./i);
    expect(q).toContain("\\&amp;");
  });

  it("GivenLongText_WhenQuoted_ThenItIsCapped", () => {
    expect(quoteUntrusted("a".repeat(1000)).length).toBeLessThanOrEqual(REPORT_QUOTE_MAX + 2);
  });
});

describe("morningReport", () => {
  const stories = [
    storyReport(
      baseLaunch(),
      ticket("AI-2"),
      [run({})],
      [finding(61, "should-fix")],
      new Set(["AI-2"]),
    ),
    storyReport(
      baseLaunch(),
      ticket("AI-3"),
      [run({ ticketId: "t3", epicMerge: null })],
      [],
      new Set(),
    ),
    storyReport(baseLaunch(), ticket("AI-4"), [], [], new Set()),
  ];
  const opened: MorningResult = {
    result: "opened",
    number: 900,
    url: `${REPO}/pull/900`,
    stories: 1,
  };

  it("GivenAnEndedLaunch_WhenRendered_ThenItIsASummaryATableAndWhatStopped", () => {
    const md = morningReport({
      launch: baseLaunch(),
      stories,
      morning: opened,
      appUrl: "https://ai.example.com",
    });

    expect(md.split("\n")[0]).toBe(reportMarker(baseLaunch()));
    expect(md).toContain(
      "Ended because its stop time passed. Of 3 stories: 1 merged, 0 done, 1 stopped, 1 not started, 0 unfinished.",
    );
    expect(md).toContain("Spend: $2.50 of $20.00, 500k of 1.0M tokens.");
    expect(md).toContain(`Morning PR: [#900](${REPO}/pull/900).`);
    expect(md).toContain(
      `| [AI-2](https://ai.example.com/p/ai/t/AI-2) | merged | [#61](${REPO}/pull/61) | 2/2 passed | 1 should-fix | 0 | $1.25 · 250k |`,
    );
    expect(md).toContain(
      "- [AI-4](https://ai.example.com/p/ai/t/AI-4) skipped: waits on AI-3, which stopped",
    );
    // The stop reason is agent text: its link is escaped, never a live link.
    expect(md).not.toContain("[red](http://x)");
  });

  it("GivenNoCodeHost_WhenRendered_ThenItSaysThereIsNoMorningPr", () => {
    expect(morningReport({ launch: baseLaunch(), stories, morning: null, appUrl: "" })).toContain(
      "Morning PR: none (no code host connected).",
    );
  });
});

describe("MorningReports", () => {
  let tracker: InMemoryWorkTracker;
  let epicId: string;
  let flag: ReturnType<typeof vi.fn<(p: string, t: string, a: string) => Promise<Ticket>>>;
  let reports: MorningReports;
  let launch: NightLaunch;

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "AI", key: "AI" });
    const epic = await tracker.createTicket("ai", { title: "Epic", type: "epic" }, "andy");
    epicId = epic.id;
    const story = await tracker.createTicket("ai", { title: "Story", parentId: epic.id }, "andy");
    flag = vi.fn(async (_p: string, _t: string, _a: string) => ({}) as Ticket);
    const runs = {
      listForTicket: async (_p: string, id: string) =>
        id === story.id ? [run({ ticketId: story.id })] : [],
    };
    reports = new MorningReports(tracker, runs, { flag }, "", {
      recent: async () => [finding(61, "blocker")],
    });
    launch = baseLaunch({ epicId, epicKey: epic.key, storyKeys: [story.key], stoppedStories: [] });
  });

  const comments = async () =>
    (await tracker.listEvents("ai", epicId)).filter((e) => e.kind === "comment");

  it("GivenAnEndedLaunch_WhenPosted_ThenOneCommentIsOnTheEpicAndItIsFlagged", async () => {
    expect(await reports.post(launch, null)).toBe(true);

    const [comment] = await comments();
    expect(comment!.body).toContain("| merged | [#61]");
    expect(comment!.body).toContain("1 blocker");
    expect(comment!.actor).toBe("system");
    expect(flag).toHaveBeenCalledWith("ai", epicId, "system");
  });

  it("GivenTheReportWasPosted_WhenPostedAgain_ThenThereIsStillOneComment", async () => {
    await reports.post(launch, null);
    expect(await reports.post(launch, null)).toBe(false);
    expect(await comments()).toHaveLength(1);
  });

  it("GivenAStoryKeyWithNoTicket_WhenPosted_ThenItIsARowMarkedMissingAndCounted", async () => {
    const withGone = NightLaunch.parse({ ...launch, storyKeys: [...launch.storyKeys, "AI-99"] });
    await reports.post(withGone, null);
    const [comment] = await comments();
    expect(comment!.body).toContain("Of 2 stories: 1 merged");
    expect(comment!.body).toContain(", 1 missing.");
    expect(comment!.body).toContain(
      "[AI-99](/p/ai/t/AI-99) missing: its ticket isn't in this project any more",
    );
  });

  it("GivenTheFlagFailsOnce_WhenPostedTwice_ThenTheEpicEndsFlaggedWithOneReport", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    flag.mockRejectedValueOnce(new Error("tracker down"));
    expect(await reports.post(launch, null)).toBe(false);
    expect(await comments()).toHaveLength(0);

    expect(await reports.post(launch, null)).toBe(true);
    expect(await comments()).toHaveLength(1);
    expect(flag).toHaveBeenCalledTimes(2);
  });

  it("GivenALaunchStillRunning_WhenPosted_ThenNothingIsWritten", async () => {
    const running = NightLaunch.parse({
      ...launch,
      status: "running",
      endedAt: null,
      endReason: null,
    });
    expect(await reports.post(running, null)).toBe(false);
    expect(await comments()).toHaveLength(0);
  });

  it("GivenAFailingRead_WhenPosted_ThenItLogsAndDoesNotThrow", async () => {
    const error = vi.spyOn(console, "log").mockImplementation(() => {});
    const broken = new MorningReports(
      {
        ...tracker,
        listEvents: async () => {
          throw new Error("down");
        },
        getTicketByKey: tracker.getTicketByKey.bind(tracker),
        addComment: tracker.addComment.bind(tracker),
      },
      { listForTicket: async () => [] },
      { flag },
      "",
    );
    expect(await broken.post(launch, null)).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("morning report failed"));
    error.mockRestore();
  });
});

describe("MorningSteps", () => {
  it("GivenAPrOpener_WhenALaunchEnds_ThenThePrOpensFirstAndTheReportLinksIt", async () => {
    const order: string[] = [];
    const opened: MorningResult = { result: "opened", number: 9, url: "u", stories: 1 };
    const steps = new MorningSteps(
      { open: async () => (order.push("pr"), opened) },
      { post: async (_l, m) => (order.push(`report:${m?.result}`), true) },
    );

    expect(await steps.open(baseLaunch())).toBe(opened);
    expect(order).toEqual(["pr", "report:opened"]);
  });

  it("GivenNoCodeHost_WhenALaunchEnds_ThenTheReportStillPosts", async () => {
    const post = vi.fn(async () => true);
    await new MorningSteps(null, { post }).open(baseLaunch());
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ id: "launch-1" }), null);
  });
});
