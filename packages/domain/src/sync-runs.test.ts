import {
  InMemoryCodeHost,
  InMemoryQuotaStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type Run,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ACTIVE_RUNS_GLOBAL } from "./dispatch-caps";
import { RunService, checkSync, type RunResult } from "./runs";
import {
  MAX_SYNC_RUNS_PER_PR_PER_DAY,
  SyncRuns,
  maySync,
  pullRequestNumber,
  syncPendingFor,
  syncsInLastDay,
} from "./sync-runs";
import { WorkflowExecutor, buildOutput } from "./test-executor";

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const sha = (c: string) => c.repeat(40);

const syncOutput = (outcome: "synced" | "conflict_unresolved" | "checks_failed") => ({
  outcome,
  summary: outcome === "synced" ? "Resolved a.ts." : "Both sides change the same rule.",
  conflictFiles: ["packages/domain/src/a.ts"],
  reason: outcome === "synced" ? "" : "The PR and main change the gate's order differently.",
  verification: [{ command: "pnpm test", passed: outcome !== "checks_failed", output: "ok" }],
});

describe("maySync", () => {
  const counts = { globalActive: 0, quotaLevel: "ok" as const, syncsToday: 0, ticketBusy: false };
  const project = { paused: false, buildEnabled: true };

  it("GivenEachCap_WhenAsked_ThenItNamesTheFirstThatStopsTheStart", () => {
    expect(maySync(project, counts)).toBe("start");
    expect(maySync({ ...project, buildEnabled: false }, counts)).toBe("builds_off");
    expect(maySync({ ...project, paused: true }, counts)).toBe("paused");
    expect(maySync(project, { ...counts, globalActive: MAX_ACTIVE_RUNS_GLOBAL })).toBe(
      "global_cap",
    );
    expect(maySync(project, { ...counts, quotaLevel: "pause" })).toBe("quota_reserve");
    expect(maySync(project, { ...counts, quotaLevel: "unknown" })).toBe("start");
    expect(maySync(project, { ...counts, syncsToday: MAX_SYNC_RUNS_PER_PR_PER_DAY })).toBe(
      "daily_cap",
    );
    expect(maySync(project, { ...counts, ticketBusy: true })).toBe("ticket_busy");
  });

  it("GivenPullRequestUrls_WhenParsed_ThenOnlyTheNumberAtTheEndCounts", () => {
    expect(pullRequestNumber("https://github.com/a/b/pull/42")).toBe(42);
    expect(pullRequestNumber("https://github.com/a/b/pull/42/files")).toBeNull();
    expect(pullRequestNumber(undefined)).toBeNull();
  });
});

describe("SyncRuns", () => {
  let now: Date;
  let tracker: InMemoryWorkTracker;
  let store: InMemoryRunStore;
  let host: InMemoryCodeHost;
  let runs: RunService;
  let quota: InMemoryQuotaStore;
  let sync: SyncRuns;
  let projectId: string;
  const clock = () => now;

  /** A ticket whose build run opened PR #`n` on `agent/<KEY>/<run>`, head `head`. */
  async function agentPr(n: number, head: string) {
    const ticket = await tracker.createTicket(
      projectId,
      {
        type: "feature",
        title: `Ticket ${n}`,
        body: "Andy can't see it.",
        acceptanceCriteria: ["WHEN Andy looks THE SYSTEM SHALL show it"],
        size: "S",
        sizeReason: "small",
      },
      "andy",
    );
    await tracker.updateTicket(
      projectId,
      ticket.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
    const run = await runs.start(projectId, ticket.id, "build");
    await runs.context(run.id, run.executor!);
    const url = `${REPO.url}/pull/${n}`;
    const branch = `agent/${ticket.key}/${run.id}`;
    await runs.report(run.id, run.executor!, {
      status: "succeeded",
      summary: "done",
      output: buildOutput,
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0,
      branch,
      pullRequest: url,
    });
    host.pullRequests.set(n, {
      pullRequest: {
        number: n,
        state: "open",
        draft: false,
        title: ticket.title,
        bodyFirstLine: "",
        fromFork: false,
        intoDefaultBranch: true,
        headRef: branch,
        headSha: head,
        baseRef: "main",
        url,
      },
      files: { items: [], complete: true },
      checks: { items: [], complete: true },
      commits: { items: [], complete: true },
    });
    return { ticket, build: (await store.get(run.id))! };
  }

  const syncRunsOf = async (ticketId: string) =>
    (await store.listForTicket(projectId, ticketId)).filter((r) => r.step === "sync");

  async function reportSync(run: Run, result: Partial<RunResult>) {
    await runs.context(run.id, run.executor!);
    return runs.report(run.id, run.executor!, {
      status: "succeeded",
      summary: null,
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0,
      ...result,
    });
  }

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    now = new Date("2026-11-10T12:00:00.000Z");
    tracker = new InMemoryWorkTracker(clock);
    store = new InMemoryRunStore(clock);
    host = new InMemoryCodeHost([REPO], clock);
    quota = new InMemoryQuotaStore();
    runs = new RunService(tracker, store, new WorkflowExecutor(host), clock);
    sync = new SyncRuns(tracker, store, runs, host, clock, quota);
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, { buildEnabled: true, runsAtOnce: 4 });
  });

  it("GivenOneStaleAndOneCurrentPr_WhenMainMoves_ThenOneSyncRunStartsForTheStaleOneOnly", async () => {
    const stale = await agentPr(40, sha("a"));
    const current = await agentPr(41, sha("b"));
    host.behindDefault.add(sha("a"));

    await sync.defaultBranchMoved(projectId);

    const [run] = await syncRunsOf(stale.ticket.id);
    expect(run).toMatchObject({
      step: "sync",
      status: "queued",
      syncRun: {
        buildRunId: stale.build.id,
        number: 40,
        branch: stale.build.branch,
        headSha: sha("a"),
        outcome: null,
      },
    });
    expect(await syncRunsOf(current.ticket.id)).toEqual([]);
    expect((await store.get(stale.build.id))!.prSync?.pendingSince).toBeNull();
    const context = await runs.context(run!.id, run!.executor!);
    expect(context).toMatchObject({
      step: "sync",
      branch: stale.build.branch,
      sync: { pullRequest: 40, headSha: sha("a") },
    });
    expect(context.prompt).toContain("sync step");
  });

  it("GivenASyncInFlight_WhenMainMovesAgain_ThenTheNewerPushCoalescesAndRunsOnceItEnds", async () => {
    const pr = await agentPr(40, sha("a"));
    host.behindDefault.add(sha("a"));
    await sync.defaultBranchMoved(projectId);
    await sync.defaultBranchMoved(projectId);
    const [first, ...more] = await syncRunsOf(pr.ticket.id);
    expect(more).toEqual([]);
    expect((await store.get(pr.build.id))!.prSync).toMatchObject({ waiting: "ticket_busy" });
    expect(syncPendingFor((await store.get(pr.build.id))!, [first!], now)).toBe(true);

    // The sync pushes a merge that still lacks the newest main: the queued sync starts.
    host.pullRequests.get(40)!.pullRequest.headSha = sha("c");
    host.behindDefault.add(sha("c"));
    await reportSync(first!, {
      output: syncOutput("synced"),
      branch: pr.build.branch,
      headSha: sha("c"),
    });
    await sync.next(projectId);
    const all = await syncRunsOf(pr.ticket.id);
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === first!.id)!.syncRun).toMatchObject({
      outcome: "synced",
      pushedSha: sha("c"),
    });
  });

  it("GivenAPendingSyncWhoseHeadCaughtUp_WhenNext_ThenItIsDroppedWithoutARun", async () => {
    const pr = await agentPr(40, sha("a"));
    host.behindDefault.add(sha("a"));
    await tracker.updateProject(projectId, { paused: true });
    await sync.defaultBranchMoved(projectId);
    expect((await store.get(pr.build.id))!.prSync).toMatchObject({ waiting: "paused" });

    host.behindDefault.delete(sha("a"));
    await tracker.updateProject(projectId, { paused: false });
    await sync.next(projectId);
    expect(await syncRunsOf(pr.ticket.id)).toEqual([]);
    expect((await store.get(pr.build.id))!.prSync).toMatchObject({
      pendingSince: null,
      waiting: null,
    });
  });

  it("GivenAConflictTheAgentCouldntResolve_WhenReported_ThenNeedsYouAndNoSyncUntilTheHeadChanges", async () => {
    const pr = await agentPr(40, sha("a"));
    host.behindDefault.add(sha("a"));
    await sync.defaultBranchMoved(projectId);
    const [run] = await syncRunsOf(pr.ticket.id);
    await reportSync(run!, { output: syncOutput("conflict_unresolved") });

    const ticket = (await tracker.getTicket(projectId, pr.ticket.id))!;
    expect(ticket.needsAttention).toBe(true);
    const comments = (await tracker.listEvents(projectId, pr.ticket.id)).filter(
      (e) => e.kind === "comment",
    );
    expect(comments.at(-1)!.body).toMatch(/Needs you.*conflict.*packages\/domain\/src\/a\.ts/s);
    expect((await store.get(pr.build.id))!.prSync).toMatchObject({ stoppedHeadSha: sha("a") });
    expect((await store.get(run!.id))!.syncRun).toMatchObject({
      outcome: "conflict_unresolved",
      conflictFiles: ["packages/domain/src/a.ts"],
    });

    await sync.defaultBranchMoved(projectId);
    expect(await syncRunsOf(pr.ticket.id)).toHaveLength(1);

    // Andy pushes to the branch: a new head, still behind main, syncs again.
    host.pullRequests.get(40)!.pullRequest.headSha = sha("d");
    host.behindDefault.add(sha("d"));
    await sync.defaultBranchMoved(projectId);
    expect(await syncRunsOf(pr.ticket.id)).toHaveLength(2);
  });

  it("GivenChecksFailedAfterTheMerge_WhenReported_ThenItStopsLikeAConflict", async () => {
    const pr = await agentPr(40, sha("a"));
    host.behindDefault.add(sha("a"));
    await sync.defaultBranchMoved(projectId);
    const [run] = await syncRunsOf(pr.ticket.id);
    await reportSync(run!, { output: syncOutput("checks_failed") });
    expect((await tracker.getTicket(projectId, pr.ticket.id))!.needsAttention).toBe(true);
    expect((await store.get(pr.build.id))!.prSync?.stoppedHeadSha).toBe(sha("a"));
  });

  it("GivenThreeSyncsToday_WhenMainMovesAgain_ThenNoneStartsTheReasonIsRecordedAndAndyIsToldOnce", async () => {
    const pr = await agentPr(40, sha("a"));
    for (const [i, head] of ["a", "b", "c"].entries()) {
      host.pullRequests.get(40)!.pullRequest.headSha = sha(head);
      host.behindDefault.add(sha(head));
      await sync.defaultBranchMoved(projectId);
      const run = (await syncRunsOf(pr.ticket.id)).find((r) => r.status === "queued")!;
      expect(await syncRunsOf(pr.ticket.id)).toHaveLength(i + 1);
      await reportSync(run, { alreadyCurrent: true });
    }
    host.pullRequests.get(40)!.pullRequest.headSha = sha("e");
    host.behindDefault.add(sha("e"));
    await sync.defaultBranchMoved(projectId);
    await sync.defaultBranchMoved(projectId);
    expect(await syncRunsOf(pr.ticket.id)).toHaveLength(3);
    expect((await store.get(pr.build.id))!.prSync).toMatchObject({
      waiting: "daily_cap",
      capFlaggedDay: "2026-11-10",
    });
    expect((await tracker.getTicket(projectId, pr.ticket.id))!.needsAttention).toBe(true);
    const capped = (await tracker.listEvents(projectId, pr.ticket.id)).filter((e) =>
      e.body?.includes("sync runs in 24 hours"),
    );
    expect(capped).toHaveLength(1);

    // 24 hours later the cap lifts.
    now = new Date(now.getTime() + 24 * 3_600_000 + 1);
    await sync.next(projectId);
    expect(await syncRunsOf(pr.ticket.id)).toHaveLength(4);
  });

  it("GivenQuotaAtTheReserve_WhenMainMoves_ThenNoSyncStartsAndTheReasonIsRecorded", async () => {
    await quota.save([
      {
        provider: "claude-sub",
        window: "5h",
        usedPct: 95,
        resetsAt: new Date(now.getTime() + 3_600_000).toISOString(),
        source: "test",
        takenAt: now.toISOString(),
        confidence: "high",
      },
    ]);
    const pr = await agentPr(40, sha("a"));
    host.behindDefault.add(sha("a"));
    await sync.defaultBranchMoved(projectId);
    expect(await syncRunsOf(pr.ticket.id)).toEqual([]);
    expect((await store.get(pr.build.id))!.prSync).toMatchObject({ waiting: "quota_reserve" });
  });

  it("GivenTheGlobalCapReached_WhenMainMoves_ThenNoSyncStartsAndTheReasonIsRecorded", async () => {
    const pr = await agentPr(40, sha("a"));
    host.behindDefault.add(sha("a"));
    const other = (await tracker.createProject({ name: "B", key: "B", repos: [REPO.fullName] })).id;
    for (let i = 0; i < MAX_ACTIVE_RUNS_GLOBAL; i++) {
      await store.create({
        projectId: other,
        ticketId: null,
        step: "build",
        route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
        tier: "fast",
        deadline: null,
      });
    }
    await sync.defaultBranchMoved(projectId);
    expect(await syncRunsOf(pr.ticket.id)).toEqual([]);
    expect((await store.get(pr.build.id))!.prSync).toMatchObject({ waiting: "global_cap" });
  });

  it("GivenASyncInFlight_WhenTheProjectDialIsOne_ThenABuildStillStarts", async () => {
    const pr = await agentPr(40, sha("a"));
    host.behindDefault.add(sha("a"));
    await tracker.updateProject(projectId, { runsAtOnce: 1 });
    await sync.defaultBranchMoved(projectId);
    expect(await syncRunsOf(pr.ticket.id)).toHaveLength(1);
    expect(await runs.activeCounts(projectId)).toEqual({ project: 0, global: 1 });
    const next = await tracker.createTicket(
      projectId,
      {
        type: "feature",
        title: "Next",
        body: "b",
        acceptanceCriteria: ["WHEN x THE SYSTEM SHALL y"],
        size: "S",
        sizeReason: "s",
      },
      "andy",
    );
    await tracker.updateTicket(
      projectId,
      next.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
    expect((await runs.start(projectId, next.id, "build")).step).toBe("build");
  });

  it("GivenARunEndedWithin24Hours_WhenCounted_ThenOnlyThatPrsSyncRunsThatReachedTheExecutorCount", () => {
    const base = { step: "sync", executor: { repo: "r", ref: "x", externalId: "1" } } as const;
    const at = (h: number) => new Date(Date.parse("2026-11-10T12:00:00Z") - h * 3_600_000);
    const run = (over: object) =>
      ({ ...base, syncRun: { buildRunId: "b1" }, createdAt: at(1).toISOString(), ...over }) as Run;
    const runs = [
      run({}),
      run({ createdAt: at(25).toISOString() }),
      run({ executor: null }),
      run({ syncRun: { buildRunId: "b2" } }),
    ];
    expect(syncsInLastDay(runs, "b1", at(0))).toBe(1);
  });
});

describe("checkSync", () => {
  const run = {
    id: "s1",
    syncRun: {
      buildRunId: "b1",
      pullRequest: "https://github.com/a/b/pull/1",
      number: 1,
      branch: "agent/AI-1/b1",
      headSha: sha("a"),
      outcome: null,
      pushedSha: null,
      conflictFiles: [],
      reason: null,
    },
  } as unknown as Run;
  const result = (over: Partial<RunResult>): RunResult => ({
    status: "succeeded",
    summary: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    ...over,
  });

  it("GivenSyncedWithoutAPushToItsOwnBranch_WhenChecked_ThenTheRunFails", () => {
    expect(checkSync(run, result({ output: syncOutput("synced") })).error).toMatch(
      /without pushing/,
    );
    expect(
      checkSync(run, result({ output: syncOutput("synced"), branch: "main", headSha: sha("c") }))
        .error,
    ).toMatch(/without pushing/);
    expect(
      checkSync(
        run,
        result({ output: syncOutput("synced"), branch: "agent/AI-1/b1", headSha: sha("c") }),
      ),
    ).toMatchObject({ error: null, record: { outcome: "synced", pushedSha: sha("c") } });
  });

  it("GivenAMalformedResultOrAlreadyCurrent_WhenChecked_ThenRejectedOrRecordedAsSuch", () => {
    expect(checkSync(run, result({ output: { outcome: "merged" } })).error).toMatch(/rejected/);
    expect(checkSync(run, result({ alreadyCurrent: true })).record?.outcome).toBe(
      "already_current",
    );
    // A failed executor can't claim already_current.
    expect(checkSync(run, result({ status: "failed", alreadyCurrent: true })).error).toMatch(
      /rejected/,
    );
  });
});
