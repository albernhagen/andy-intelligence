import {
  buildRun,
  type QuotaReading,
  type Run,
  type Ticket,
  type TicketEvent,
} from "@andy/contracts";
import { describe, expect, it } from "vitest";
import {
  buildDigest,
  digestWindow,
  DigestReader,
  type DigestData,
  type DigestWindow,
} from "./digest";
import { InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";

const NOW = new Date("2026-11-09T22:00:00.000Z");
const WINDOW: DigestWindow = digestWindow(NOW);
const IN = "2026-11-09T12:00:00.000Z";
const BEFORE = "2026-11-07T12:00:00.000Z";

const ticket = (n: number, over: Partial<Ticket> = {}): Ticket =>
  ({
    id: `t${n}`,
    projectId: "ai",
    key: `AI-${n}`,
    title: `Ticket ${n}`,
    type: "feature",
    stage: "in_progress",
    rank: String(n).padStart(10, "0"),
    archived: false,
    needsAttention: false,
    dorStatus: "met",
    blockedBy: [],
    overrides: {},
    updatedAt: IN,
    ...over,
  }) as Ticket;

const run = (over: Partial<Run> = {}): Run => ({
  ...buildRun(
    {
      projectId: "ai",
      ticketId: "t1",
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: null,
    },
    over.id ?? "r1",
    new Date(IN),
  ),
  ...over,
});

const prEvent = (ticketId: string, number: number, state: string, at = IN): TicketEvent => ({
  id: `${at}-${number}-${state}`,
  ticketId,
  kind: "pr_linked",
  actor: "system",
  runId: null,
  body: null,
  data: { number, url: `https://github.com/o/r/pull/${number}`, state },
  createdAt: at,
});

const project = {
  key: "AI",
  paused: false,
  runsAtOnce: 2,
  lastDispatch: null,
  defaultWorker: "agent" as const,
};

const data = (over: Partial<DigestData> = {}): DigestData => ({
  project,
  tickets: [],
  openQuestions: new Map(),
  activeRuns: [],
  endedRuns: [],
  ticketRuns: new Map(),
  ticketEvents: new Map(),
  quota: [],
  truncated: false,
  now: NOW,
  ...over,
});

const kinds = (d: ReturnType<typeof buildDigest>) => d.exceptions.map((e) => e.kind);

describe("buildDigest", () => {
  it("GivenNothingInTheWindow_WhenBuilt_ThenQuietWithOneLine", () => {
    const d = buildDigest(WINDOW, data({ tickets: [ticket(1, { stage: "done" })] }));
    expect(d.quiet).toBe(true);
    expect(d.text).toBe("AI digest · last 24 hours: nothing happened.");
    expect(d.text.split("\n")).toHaveLength(1);
  });

  it("GivenAFailedRunThatWasRetried_WhenBuilt_ThenAnExceptionWithTheReason", () => {
    const failed = run({ status: "failed", endedAt: IN, error: "timed out" });
    const retry = run({ id: "r2", retryOf: "r1", attempt: 2, status: "running" });
    const d = buildDigest(
      WINDOW,
      data({ tickets: [ticket(1)], endedRuns: [failed], activeRuns: [retry] }),
    );
    expect(d.exceptions[0]).toMatchObject({
      kind: "run_failed",
      ticketKey: "AI-1",
      reason: "Build run failed, retried: timed out",
    });
    expect(d.totals).toMatchObject({ runs: 1, failedRuns: 1 });
  });

  it("GivenAPrClosedUnmerged_WhenBuilt_ThenPrClosedException", () => {
    const d = buildDigest(
      WINDOW,
      data({ tickets: [ticket(1)], ticketEvents: new Map([["t1", [prEvent("t1", 7, "closed")]]]) }),
    );
    expect(d.exceptions).toContainEqual(
      expect.objectContaining({
        kind: "pr_closed",
        prNumber: 7,
        reason: "PR #7 closed without merging",
      }),
    );
  });

  it("GivenAPrClosedBeforeTheWindow_WhenBuilt_ThenNotListed", () => {
    const events = new Map([["t1", [prEvent("t1", 7, "closed", BEFORE)]]]);
    expect(
      kinds(buildDigest(WINDOW, data({ tickets: [ticket(1)], ticketEvents: events }))),
    ).toEqual([]);
  });

  it("GivenReworkedAndRevertedOutcomes_WhenBuilt_ThenBothListed", () => {
    const url = (n: number) => `https://github.com/o/r/pull/${n}`;
    const reworked = run({
      outcome: "reworked",
      links: { pullRequest: url(1) },
      metrics: {
        ciGreenFirstTry: true,
        reviewFailures: [],
        reviewBlockers: 0,
        andyCommits: 0,
        reworks: 2,
        costEstimateUsd: null,
      },
    });
    const reverted = run({
      id: "r2",
      ticketId: "t2",
      outcome: "reverted",
      links: { pullRequest: url(2) },
    });
    const d = buildDigest(
      WINDOW,
      data({
        tickets: [ticket(1, { stage: "done" }), ticket(2, { stage: "done" })],
        ticketEvents: new Map([
          ["t1", [prEvent("t1", 1, "merged")]],
          ["t2", [prEvent("t2", 2, "merged")]],
        ]),
        ticketRuns: new Map([
          ["t1", [reworked]],
          ["t2", [reverted]],
        ]),
      }),
    );
    expect(d.exceptions.map((e) => e.reason)).toEqual([
      "PR #1 needed rework (2 times)",
      "PR #2 was reverted",
    ]);
  });

  it("GivenAnOpenPrWithAReviewBlocker_WhenBuilt_ThenReviewBlockerNamesTheReviewer", () => {
    const blocked = run({
      links: { pullRequest: "https://github.com/o/r/pull/9" },
      metrics: {
        ciGreenFirstTry: null,
        reviewFailures: ["adversarial-review@abc", "adversarial-review@def"],
        reviewBlockers: null,
        andyCommits: null,
        reworks: null,
        costEstimateUsd: null,
      },
    });
    const d = buildDigest(
      WINDOW,
      data({
        tickets: [ticket(1, { stage: "ready_for_review" })],
        ticketEvents: new Map([["t1", [prEvent("t1", 9, "open", BEFORE)]]]),
        ticketRuns: new Map([["t1", [blocked]]]),
      }),
    );
    expect(d.exceptions).toEqual([
      expect.objectContaining({
        kind: "review_blocker",
        reason: "PR #9: blocker from adversarial-review",
      }),
    ]);
    expect(d.inProgress.readyForReview).toEqual([
      { ticketKey: "AI-1", title: "Ticket 1", prNumber: 9 },
    ]);
  });

  it("GivenTicketsWaitingOnAndyOrBlocked_WhenBuilt_ThenEachWithWhy", () => {
    const tickets = [
      ticket(1, { stage: "backlog" }),
      ticket(2, { stage: "ready", overrides: { assignee: "me" } }),
      ticket(3, { stage: "ready", blockedBy: ["t4"] }),
      ticket(4, { stage: "backlog", needsAttention: true }),
    ];
    const d = buildDigest(WINDOW, data({ tickets, openQuestions: new Map([["t1", 2]]) }));
    expect(d.exceptions.map((e) => [e.kind, e.ticketKey, e.reason])).toEqual([
      ["waiting_on_andy", "AI-1", "Waiting for you: 2 questions"],
      ["waiting_on_andy", "AI-2", "Mine · waiting on you"],
      ["blocked", "AI-3", "Blocked by AI-4"],
      ["waiting_on_andy", "AI-4", "Waiting for you"],
    ]);
  });

  it("GivenAPausedProjectOrACapIdle_WhenBuilt_ThenDispatchIdleWithTheReason", () => {
    const paused = buildDigest(WINDOW, data({ project: { ...project, paused: true } }));
    expect(paused.exceptions).toEqual([
      expect.objectContaining({ kind: "dispatch_idle", reason: "Dispatch is paused" }),
    ]);
    const capped = buildDigest(
      WINDOW,
      data({ project: { ...project, lastDispatch: { decision: "project_cap", at: IN } } }),
    );
    expect(capped.exceptions[0]).toMatchObject({
      reason: "Dispatch is at the project's dial (2 runs at once)",
      at: IN,
    });
  });

  it("GivenQuotaPastThePauseLine_WhenBuilt_ThenQuotaReserveException", () => {
    const reading: QuotaReading = {
      provider: "claude-sub",
      window: "weekly",
      usedPct: 85,
      resetsAt: "2026-11-12T00:00:00.000Z",
      source: "test",
      takenAt: IN,
      confidence: "high",
    };
    const d = buildDigest(WINDOW, data({ quota: [reading] }));
    expect(d.exceptions).toEqual([
      expect.objectContaining({
        kind: "quota_reserve",
        reason: "Weekly quota 85% used: at the reserve (dispatch stops at 80%)",
      }),
    ]);
  });

  it("GivenAMergedPr_WhenBuilt_ThenMergedWithWhoGateAndCostAndTotals", () => {
    const url = "https://github.com/o/r/pull/5";
    const merged = run({
      status: "succeeded",
      endedAt: IN,
      links: { pullRequest: url },
      costUsd: 1.25,
      wouldAutoMerge: false,
      gateReasons: ["protected_path"],
      quotaDelta: { "5h": 3, weekly: 1 },
    });
    const d = buildDigest(
      WINDOW,
      data({
        tickets: [ticket(1, { stage: "done" })],
        endedRuns: [merged],
        ticketEvents: new Map([["t1", [prEvent("t1", 5, "open"), prEvent("t1", 5, "merged")]]]),
        ticketRuns: new Map([["t1", [merged]]]),
      }),
    );
    expect(d.merged).toEqual([
      expect.objectContaining({
        ticketKey: "AI-1",
        prNumber: 5,
        mergedBy: "andy",
        gate: { wouldAutoMerge: false, reasons: ["protected_path"], outcome: null },
        costUsd: 1.25,
      }),
    ]);
    expect(d.totals).toEqual({
      runs: 1,
      failedRuns: 0,
      costUsd: 1.25,
      unknownCostRuns: 0,
      quotaDelta: { "5h": 3, weekly: 1 },
      merged: 1,
    });
    expect(d.text).toContain(
      "AI-1: Ticket 1 · PR #5 · merged by Andy · gate held (protected_path) · $1.25",
    );
  });

  it("GivenAMergeTheGateMade_WhenBuilt_ThenMergedByGate", () => {
    const url = "https://github.com/o/r/pull/5";
    const r = run({ links: { pullRequest: url }, mergeAttemptedSha: "abc", wouldAutoMerge: true });
    const d = buildDigest(
      WINDOW,
      data({
        tickets: [ticket(1, { stage: "done" })],
        ticketEvents: new Map([["t1", [prEvent("t1", 5, "merged")]]]),
        ticketRuns: new Map([["t1", [r]]]),
      }),
    );
    expect(d.merged[0]?.mergedBy).toBe("gate");
  });

  it("GivenAMergedPrNoRunLinksTo_WhenBuilt_ThenMergerAndGateUnknownNotAnotherRuns", () => {
    const other = run({
      links: { pullRequest: "https://github.com/o/r/pull/99" },
      mergeAttemptedSha: "abc",
      wouldAutoMerge: true,
    });
    const d = buildDigest(
      WINDOW,
      data({
        tickets: [ticket(1, { stage: "done" })],
        ticketEvents: new Map([["t1", [prEvent("t1", 5, "merged")]]]),
        ticketRuns: new Map([["t1", [other]]]),
      }),
    );
    expect(d.merged[0]).toMatchObject({ mergedBy: "unknown", gate: null });
    expect(d.text).toContain("PR #5 · merger unknown · gate unknown");
  });

  it("GivenTheSamePrNumberInTwoRepos_WhenBuilt_ThenBothAreListed", () => {
    const event = (ticketId: string, repo: string): TicketEvent => ({
      ...prEvent(ticketId, 4, "merged"),
      id: `e-${repo}`,
      data: { number: 4, url: `https://github.com/o/${repo}/pull/4`, state: "merged" },
    });
    const d = buildDigest(
      WINDOW,
      data({
        tickets: [ticket(1, { stage: "done" }), ticket(2, { stage: "done" })],
        ticketEvents: new Map([
          ["t1", [event("t1", "api")]],
          ["t2", [event("t2", "web")]],
        ]),
      }),
    );
    expect(d.merged.map((m) => m.prUrl)).toEqual([
      "https://github.com/o/api/pull/4",
      "https://github.com/o/web/pull/4",
    ]);
  });

  it("GivenEverySection_WhenRendered_ThenExceptionsMergedInProgressTotalsInOrder", () => {
    const active = run({ id: "r9", ticketId: "t2", status: "running", startedAt: IN });
    const d = buildDigest(
      WINDOW,
      data({
        project: { ...project, paused: true },
        tickets: [ticket(1, { stage: "done" }), ticket(2)],
        activeRuns: [active],
        ticketEvents: new Map([["t1", [prEvent("t1", 5, "merged")]]]),
      }),
    );
    const at = (s: string) => d.text.indexOf(s);
    expect(at("Exceptions")).toBeGreaterThan(0);
    expect(at("Exceptions")).toBeLessThan(at("Merged"));
    expect(at("Merged")).toBeLessThan(at("In progress"));
    expect(at("In progress")).toBeLessThan(at("Totals"));
    expect(d.inProgress.inFlight[0]).toMatchObject({
      ticketKey: "AI-2",
      label: "Building · 600 min",
    });
  });

  it("GivenARunPastItsDeadline_WhenBuilt_ThenItIsNotListedInFlight", () => {
    const live = run({ id: "r8", ticketId: "t1", status: "running", startedAt: IN });
    const late = run({
      id: "r9",
      ticketId: "t2",
      status: "running",
      startedAt: IN,
      deadline: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    const d = buildDigest(
      WINDOW,
      data({ tickets: [ticket(1), ticket(2)], activeRuns: [live, late] }),
    );
    expect(d.inProgress.inFlight.map((r) => r.ticketKey)).toEqual(["AI-1"]);
  });

  it("GivenAPastWindow_WhenBuilt_ThenCurrentStateIsLeftOut", () => {
    const past = digestWindow(NOW, 24, "2026-11-01T00:00:00.000Z");
    const d = buildDigest(
      past,
      data({
        project: { ...project, paused: true },
        tickets: [ticket(1, { needsAttention: true })],
      }),
    );
    expect(d.quiet).toBe(true);
    expect(d.text).toBe(
      "AI digest · 2026-10-31 00:00 UTC to 2026-11-01 00:00 UTC: nothing happened.",
    );
  });

  it("GivenTruncatedReads_WhenRendered_ThenTheTextSaysSomeMayBeMissing", () => {
    const d = buildDigest(WINDOW, data({ truncated: true, project: { ...project, paused: true } }));
    expect(d.text).toContain("some tickets or runs may be missing");
  });
});

describe("digestWindow", () => {
  it("GivenNoInput_WhenResolved_ThenTheLast24Hours", () => {
    expect(digestWindow(NOW)).toEqual({ from: new Date("2026-11-08T22:00:00.000Z"), to: NOW });
  });

  it("GivenAFutureUntilAndTooManyHours_WhenResolved_ThenClampedToNowAnd168", () => {
    const w = digestWindow(NOW, 1000, "2030-01-01T00:00:00.000Z");
    expect(w.to).toEqual(NOW);
    expect(w.to.getTime() - w.from.getTime()).toBe(168 * 3_600_000);
  });
});

describe("DigestReader", () => {
  it("GivenAProjectWithAFailedRun_WhenRead_ThenTheDigestHasItAndTheTotals", async () => {
    const tracker = new InMemoryWorkTracker();
    const runs = new InMemoryRunStore();
    const p = await tracker.createProject({ name: "AI", key: "AI", repos: [] });
    const t = await tracker.createTicket(p.id, { type: "feature", title: "B" }, "andy");
    const created = await runs.create({
      projectId: p.id,
      ticketId: t.id,
      step: "refine",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: null,
    });
    await runs.update(
      created.id,
      { status: "failed", endedAt: new Date().toISOString(), error: "boom" },
      ["queued"],
    );
    const d = await new DigestReader(tracker, runs, null).digest(p.id, digestWindow(new Date()));
    expect(d.exceptions[0]).toMatchObject({ kind: "run_failed", ticketKey: t.key });
    expect(d.totals.failedRuns).toBe(1);
  });

  it("GivenAnUnknownProject_WhenRead_ThenNotFound", async () => {
    const reader = new DigestReader(new InMemoryWorkTracker(), new InMemoryRunStore(), null);
    await expect(reader.digest("zz", digestWindow(new Date()))).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("DigestReader caps", () => {
  it("GivenMoreEndedRunsThanTheCap_WhenRead_ThenTruncated", async () => {
    const tracker = new InMemoryWorkTracker();
    const p = await tracker.createProject({ name: "AI", key: "AI", repos: [] });
    const runs = new InMemoryRunStore();
    const capped = {
      ...runs,
      listActive: (id: string) => runs.listActive(id),
      listForTicket: (id: string, t: string) => runs.listForTicket(id, t),
      listEndedBetween: async () => ({ runs: [], complete: false }),
    } as unknown as InMemoryRunStore;
    const d = await new DigestReader(tracker, capped, null).digest(p.id, digestWindow(new Date()));
    expect(d.truncated).toBe(true);
    expect(d.text).toContain("A read cap was reached");
  });
});
