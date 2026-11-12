import {
  InMemoryCodeHost,
  InMemoryNightLaunchStore,
  InMemoryQuotaStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type Executor,
  type NewTicket,
  type NightLaunch,
  type NightLaunchStore,
  type PlanApproval,
  type Run,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildDispatcher } from "./build-dispatch";
import { MAX_BUILD_RUNS_PER_TICKET, branchFor } from "./builds";
import { MAX_ACTIVE_RUNS_GLOBAL, MAX_PRS_WAITING_PER_PROJECT } from "./dispatch-caps";
import { MAX_PLAN_RUNS_PER_TICKET } from "./plans";
import { ProjectService } from "./projects";
import { RunService, type RunResult } from "./runs";
import { WorkflowExecutor, buildOutput } from "./test-executor";
import { TicketService } from "./tickets";

/** The owner as owner-only rules take them (AI-19). */
const OWNER = { actor: "andy", email: "andy@example.com" };

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};

/** A ticket that meets the Definition of Ready; its touches are its own area (no overlaps). */
const ready = (title: string, extra: Partial<NewTicket> = {}): NewTicket => ({
  type: "feature",
  title,
  body: "Andy can't see his tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
  size: "S",
  sizeReason: "one screen",
  touches: [`areas/${title}/**`],
  ...extra,
});

describe("BuildDispatcher", () => {
  let tracker: InMemoryWorkTracker;
  let runStore: InMemoryRunStore;
  let host: InMemoryCodeHost;
  let projectId: string;
  let ms: number;
  const now = () => new Date((ms += 1000));

  function wire(
    executor: Executor | null = new WorkflowExecutor(host),
    nights: NightLaunchStore | null = null,
  ) {
    const runs: RunService = new RunService(
      tracker,
      runStore,
      executor,
      now,
      null,
      async (p) => {
        await dispatcher.next(p);
      },
      host,
    );
    const dispatcher = new BuildDispatcher(tracker, runStore, runs, now, null, nights);
    const next = (p: string) => dispatcher.next(p);
    return {
      runs,
      dispatcher,
      tickets: new TicketService(tracker, runs, next),
      projects: new ProjectService(tracker, null, next),
    };
  }

  const builds = async (ticketId: string) =>
    (await runStore.listForTicket(projectId, ticketId)).filter((r) => r.step === "build");
  const inReady = async (title: string, extra: Partial<NewTicket> = {}) => {
    const t = await tracker.createTicket(projectId, ready(title, extra), "andy");
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
  };
  const succeed = (runs: RunService, run: Run, extra: Partial<RunResult> = {}) =>
    runs.report(run.id, run.executor!, {
      status: "succeeded",
      summary: "done",
      output: buildOutput,
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: 0.42,
      ...extra,
    });

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    ms = Date.parse("2026-11-05T12:00:00.000Z");
    tracker = new InMemoryWorkTracker(now);
    runStore = new InMemoryRunStore(now);
    host = new InMemoryCodeHost([REPO]);
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, {
      autoRefine: false,
      autoBuild: true,
      buildEnabled: true,
    });
  });

  it("GivenAutoBuildOff_WhenATicketReachesReady_ThenNoBuildStarts", async () => {
    await tracker.updateProject(projectId, { autoBuild: false });
    const { tickets } = wire();
    const t = await tracker.createTicket(projectId, ready("Board"), "andy");
    await tickets.move(projectId, t.id, "ready", "andy");
    expect(await builds(t.id)).toEqual([]);
  });

  it("GivenAutoBuildOn_WhenATicketReachesReady_ThenItsBuildStartsAndTheTicketIsInProgress", async () => {
    const { tickets } = wire();
    const t = await tracker.createTicket(projectId, ready("Board"), "andy");
    await tickets.move(projectId, t.id, "ready", "andy");
    const [run] = await builds(t.id);
    expect(run).toMatchObject({ step: "build", status: "queued", tier: "fast" });
    expect(run!.route.model).toBe("sonnet");
    expect((await tracker.getTicket(projectId, t.id))!.stage).toBe("in_progress");
  });

  it("GivenSeveralReadyTickets_WhenNext_ThenTheTopOfTheOrderStartsFirst", async () => {
    await tracker.updateProject(projectId, { runsAtOnce: 1 });
    const { dispatcher } = wire();
    const first = await inReady("First");
    const second = await inReady("Second");
    // Andy moves Second to the top (rank is the order, ADR-0058).
    await tracker.updateTicket(projectId, second.id, { fields: { rank: "0000000000" } }, "andy");
    const run = await dispatcher.next(projectId);
    expect(run?.ticketId).toBe(second.id);
    expect(await builds(first.id)).toEqual([]);
  });

  it("GivenATopTicketBlockedByAnUnfinishedTicket_WhenNext_ThenTheNextTicketStarts", async () => {
    const { dispatcher } = wire();
    const blocker = await tracker.createTicket(projectId, ready("Blocker"), "andy");
    const blocked = await inReady("Blocked", { blockedBy: [blocker.key] });
    const free = await inReady("Free");
    const run = await dispatcher.next(projectId);
    expect(run?.ticketId).toBe(free.id);
    expect(await builds(blocked.id)).toEqual([]);
  });

  it("GivenABlockerThatIsDone_WhenNext_ThenTheBlockedTicketStarts", async () => {
    const { dispatcher } = wire();
    const blocker = await tracker.createTicket(projectId, ready("Blocker"), "andy");
    await tracker.updateTicket(
      projectId,
      blocker.id,
      { stage: { to: "done", forced: true, reason: null } },
      "andy",
    );
    const blocked = await inReady("Blocked", { blockedBy: [blocker.key] });
    expect((await dispatcher.next(projectId))?.ticketId).toBe(blocked.id);
  });

  it("GivenABlockerInAnotherProject_WhenItReachesDone_ThenTheBlockedProjectIsWokenAndTheTicketStarts", async () => {
    const { dispatcher, tickets } = wire();
    const ops = await tracker.createProject({ name: "Ops", key: "OPS", repos: [] });
    const blocker = await tracker.createTicket(ops.id, ready("Ops"), "andy");
    await tracker.updateTicket(
      ops.id,
      blocker.id,
      { stage: { to: "ready_for_review", forced: true, reason: null } },
      "andy",
    );
    const blocked = await inReady("Blocked", { blockedBy: [blocker.key] });

    expect(await dispatcher.next(projectId)).toBeNull();
    expect(await builds(blocked.id)).toEqual([]);

    await tickets.followPullRequest(ops.id, blocker.id, "done", "PR merged");
    const [run] = await builds(blocked.id);
    expect(run).toMatchObject({ step: "build" });
  });

  it("GivenOneOfTwoBlockersInOtherProjectsIsDone_WhenWoken_ThenTheTicketStillWaits", async () => {
    const { tickets } = wire();
    const ops = await tracker.createProject({ name: "Ops", key: "OPS", repos: [] });
    const web = await tracker.createProject({ name: "Web", key: "WEB", repos: [] });
    const first = await tracker.createTicket(ops.id, ready("Ops"), "andy");
    const second = await tracker.createTicket(web.id, ready("Web"), "andy");
    const blocked = await inReady("Blocked", { blockedBy: [first.key, second.key] });

    await tickets.move(ops.id, first.id, "done", "andy", { force: true });
    expect(await builds(blocked.id)).toEqual([]);
  });

  it("GivenARunInFlight_WhenNext_ThenNothingStartsUntilItEnds", async () => {
    const { dispatcher, runs } = wire();
    const a = await inReady("A");
    const b = await inReady("B");
    const first = (await dispatcher.next(projectId))!;
    expect(await dispatcher.next(projectId)).toBeNull();
    await runs.context(first.id, first.executor!);
    await succeed(runs, first, {
      branch: branchFor("AI-1", first.id),
      pullRequest: `${REPO.url}/pull/7`,
    });
    // The report ended the run, so the next Ready ticket started on its own.
    expect(first.ticketId).toBe(a.id);
    expect(await builds(b.id)).toHaveLength(1);
  });

  it("GivenFlaggedOrArchivedReadyTickets_WhenNext_ThenTheyAreSkipped", async () => {
    const { dispatcher } = wire();
    const flagged = await inReady("Flagged");
    await tracker.updateTicket(projectId, flagged.id, { fields: { needsAttention: true } }, "andy");
    expect(await dispatcher.next(projectId)).toBeNull();
  });

  it("GivenAnEpicAtTheTopOfReady_WhenNext_ThenItIsSkippedAndTheNextTicketStarts", async () => {
    const { dispatcher } = wire();
    const epic = await inReady("Milestone", {
      type: "epic",
      acceptanceCriteria: [],
      size: null,
      sizeReason: null,
    });
    const story = await inReady("Story");
    expect((await dispatcher.next(projectId))?.ticketId).toBe(story.id);
    expect(await builds(epic.id)).toEqual([]);
  });

  it("GivenATopTicketAssignedToAndy_WhenNext_ThenItIsSkippedAndTheNextTicketStarts", async () => {
    const { dispatcher } = wire();
    const mine = await inReady("Mine", { overrides: { assignee: "me" } });
    const story = await inReady("Story");
    expect((await dispatcher.next(projectId))?.ticketId).toBe(story.id);
    expect(await builds(mine.id)).toEqual([]);
  });

  it("GivenAnArchivedReadyTicket_WhenNext_ThenItIsSkipped", async () => {
    const { dispatcher } = wire();
    const t = await inReady("Archived");
    await tracker.updateTicket(projectId, t.id, { fields: { archived: true } }, "andy");
    expect(await dispatcher.next(projectId)).toBeNull();
    expect(await builds(t.id)).toEqual([]);
  });

  it("GivenACancelledTicket_WhenNext_ThenItIsNeverBuilt", async () => {
    const { dispatcher, tickets } = wire();
    const t = await inReady("Cancelled");
    await tracker.updateProject(projectId, { autoBuild: false });
    await tickets.cancel(projectId, t.id, "andy");
    await tracker.updateProject(projectId, { autoBuild: true });
    expect(await dispatcher.next(projectId)).toBeNull();
    expect(await builds(t.id)).toEqual([]);
  });

  const decision = async (p = projectId) => (await tracker.getProject(p))?.lastDispatch?.decision;

  /** A ticket in Ready for review; `agent`: a build run opened its PR. */
  const inReview = async (title: string, agent: boolean) => {
    const t = await tracker.createTicket(projectId, ready(title), "andy");
    await tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready_for_review", forced: true, reason: null } },
      "andy",
    );
    if (!agent) return;
    const run = await runStore.create({
      projectId,
      ticketId: t.id,
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: "fast",
      deadline: null,
    });
    await runStore.update(
      run.id,
      {
        status: "succeeded",
        endedAt: new Date(ms).toISOString(),
        links: { pullRequest: `https://github.com/${REPO.fullName}/pull/1` },
      },
      ["queued"],
    );
  };

  it("GivenADialOfTwoAndThreeReadyTickets_WhenNext_ThenTheTopTwoStartAndTheDecisionIsTheCap", async () => {
    const { dispatcher } = wire();
    const [a, b, c] = [await inReady("A"), await inReady("B"), await inReady("C")];
    await dispatcher.next(projectId);
    expect(await builds(a.id)).toHaveLength(1);
    expect(await builds(b.id)).toHaveLength(1);
    expect(await builds(c.id)).toEqual([]);
    expect(await decision()).toBe("project_cap");
  });

  describe("conflict-aware dispatch (ADR-0080)", () => {
    it("GivenTwoReadyTicketsWithOverlappingTouches_WhenNext_ThenOnlyTheFirstStartsAndTheNextDisjointOneDoes", async () => {
      const { dispatcher } = wire();
      const a = await inReady("A", { touches: ["packages/domain/**"] });
      const b = await inReady("B", { touches: ["packages/domain/src/runs.ts"] });
      const c = await inReady("C", { touches: ["apps/web/**"] });
      await dispatcher.next(projectId);
      expect(await builds(a.id)).toHaveLength(1);
      expect(await builds(b.id)).toEqual([]);
      expect(await builds(c.id)).toHaveLength(1);
      expect((await builds(a.id))[0]!.touches).toEqual(["packages/domain/**"]);
    });

    it("GivenOnlyOverlappingTicketsWait_WhenNext_ThenTheDecisionIsTouchesOverlap", async () => {
      const { dispatcher } = wire();
      await inReady("A", { touches: ["packages/domain/**"] });
      await dispatcher.next(projectId);
      const b = await inReady("B", { touches: ["packages/domain/src/x.ts"] });
      await dispatcher.next(projectId);
      expect(await builds(b.id)).toEqual([]);
      expect(await decision()).toBe("touches_overlap");
    });

    it("GivenATicketWithNoTouches_WhenARunIsInFlight_ThenItWaitsAndWhenNoneIs_ThenItStarts", async () => {
      const { dispatcher, runs } = wire();
      const a = await inReady("A");
      await dispatcher.next(projectId);
      const unknown = await inReady("Unknown", { touches: [] });
      await dispatcher.next(projectId);
      expect(await builds(unknown.id)).toEqual([]);
      await succeed(runs, (await builds(a.id))[0]!);
      expect(await builds(unknown.id)).toHaveLength(1);
    });

    it("GivenTheBlockingRunEnds_WhenItReports_ThenTheSkippedTicketStarts", async () => {
      const { dispatcher, runs } = wire();
      const a = await inReady("A", { touches: ["packages/domain/**"] });
      await dispatcher.next(projectId);
      const b = await inReady("B", { touches: ["packages/domain/src/x.ts"] });
      await succeed(runs, (await builds(a.id))[0]!);
      expect(await builds(b.id)).toHaveLength(1);
    });

    it("GivenTwoConcurrentStartsOfOverlappingTickets_WhenBothAvoidOverlap_ThenOnlyTheOlderBuilds", async () => {
      const { runs } = wire();
      const a = await inReady("A", { touches: ["packages/domain/**"] });
      const b = await inReady("B", { touches: ["packages/domain/src/runs.ts"] });
      const results = await Promise.allSettled([
        runs.start(projectId, a.id, "build", undefined, { avoidOverlap: true }),
        runs.start(projectId, b.id, "build", undefined, { avoidOverlap: true }),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
      expect((await builds(b.id))[0]).toMatchObject({ status: "failed" });
      expect((await runs.inFlight(projectId)).map((r) => r.ticketKey)).toEqual([a.key]);
    });

    it("GivenABuildPastItsDeadline_WhenTheViewIsRead_ThenItIsLeftOutAsTheDispatcherIgnoresIt", async () => {
      const { dispatcher, runs } = wire();
      const late = await inReady("Late", { touches: ["packages/domain/**"] });
      await dispatcher.next(projectId);
      expect((await runs.inFlight(projectId)).map((r) => r.ticketKey)).toEqual([late.key]);
      ms += 24 * 60 * 60_000; // past every step's deadline
      expect(await runs.inFlight(projectId)).toEqual([]);
      const next = await inReady("Next", { touches: ["packages/domain/src/x.ts"] });
      await dispatcher.next(projectId);
      expect(await builds(next.id)).toHaveLength(1);
    });

    it("GivenAnAdrIndex_WhenTwoBuildsStart_ThenEachReservesTheNextNumberAndThePromptSaysSo", async () => {
      host.files.set(
        "docs/architecture/adr/README.md",
        "| [0079](0079-x.md) | x | accepted |\n| [0082](0082-y.md) | y | accepted |",
      );
      const { dispatcher } = wire();
      const [a, b] = [await inReady("A"), await inReady("B")];
      await dispatcher.next(projectId);
      const [runA, runB] = [(await builds(a.id))[0]!, (await builds(b.id))[0]!];
      expect([runA.reservedAdr, runB.reservedAdr]).toEqual([83, 84]);
      expect(runA.prompt).toContain("Your ADR number, if you need one: ADR-0083");
      expect(runA.prompt).toContain(`risk IDs carry the ticket key: R-${a.key} `);
    });

    it("GivenNoAdrIndex_WhenABuildStarts_ThenNoNumberIsReserved", async () => {
      const { dispatcher } = wire();
      const a = await inReady("A");
      await dispatcher.next(projectId);
      const run = (await builds(a.id))[0]!;
      expect(run.reservedAdr).toBeNull();
      expect(run.prompt).toContain("No ADR number is reserved");
    });
  });

  it("GivenPaused_WhenNext_ThenNothingStartsAndPausedIsRecorded", async () => {
    await tracker.updateProject(projectId, { paused: true });
    const { dispatcher } = wire();
    const t = await inReady("A");
    expect(await dispatcher.next(projectId)).toBeNull();
    expect(await builds(t.id)).toEqual([]);
    expect(await decision()).toBe("paused");
  });

  it("GivenPaused_WhenAndyResumes_ThenTheWaitingTicketStarts", async () => {
    await tracker.updateProject(projectId, { paused: true });
    const { projects } = wire();
    const t = await inReady("A");
    await projects.update(projectId, { paused: false }, OWNER);
    expect(await builds(t.id)).toHaveLength(1);
    expect(await decision()).toBe("started");
  });

  it("GivenTheDialIsFull_WhenAndyRaisesIt_ThenTheNextTicketStarts", async () => {
    await tracker.updateProject(projectId, { runsAtOnce: 1 });
    const { dispatcher, projects } = wire();
    await inReady("A");
    const b = await inReady("B");
    await dispatcher.next(projectId);
    expect(await builds(b.id)).toEqual([]);
    await projects.update(projectId, { runsAtOnce: 2 }, OWNER);
    expect(await builds(b.id)).toHaveLength(1);
  });

  it("GivenAgentPrsWaitingAtTheCap_WhenNext_ThenNothingStartsAndTheReasonIsRecorded", async () => {
    const { dispatcher } = wire();
    for (let i = 0; i < MAX_PRS_WAITING_PER_PROJECT; i++) await inReview(`Built ${i}`, true);
    await inReady("Waiting");
    expect(await dispatcher.next(projectId)).toBeNull();
    expect(await decision()).toBe("prs_waiting_cap");
  });

  it("GivenPrsAndyOpenedHimself_WhenNext_ThenTheyDontCountTowardTheCap", async () => {
    const { dispatcher } = wire();
    for (let i = 0; i < MAX_PRS_WAITING_PER_PROJECT; i++) await inReview(`Own ${i}`, false);
    await inReady("Waiting");
    expect(await dispatcher.next(projectId)).not.toBeNull();
  });

  it("GivenAWaitingPrLeavesReview_WhenItMerges_ThenDispatchRunsAgain", async () => {
    const { tickets } = wire();
    for (let i = 0; i < MAX_PRS_WAITING_PER_PROJECT; i++) await inReview(`Built ${i}`, true);
    const waiting = await inReady("Waiting");
    const [first] = await tracker.listTickets(projectId, { stage: "ready_for_review" });
    await tickets.move(projectId, first!.id, "done", "andy");
    expect(await builds(waiting.id)).toHaveLength(1);
  });

  it("GivenQuotaAtThePauseLevel_WhenNext_ThenNothingStartsAndTheReserveIsRecorded", async () => {
    const quota = new InMemoryQuotaStore();
    await quota.save([
      {
        provider: "claude-sub",
        window: "5h",
        usedPct: 90,
        resetsAt: new Date(ms + 3_600_000).toISOString(),
        source: "test",
        takenAt: new Date(ms).toISOString(),
        confidence: "high",
      },
    ]);
    const { runs } = wire();
    const dispatcher = new BuildDispatcher(tracker, runStore, runs, now, quota);
    await inReady("A");
    expect(await dispatcher.next(projectId)).toBeNull();
    expect(await decision()).toBe("quota_reserve");
  });

  it("GivenAPauseLevelReadingOverSixHoursOld_WhenNext_ThenDispatchStarts", async () => {
    const quota = new InMemoryQuotaStore();
    await quota.save([
      {
        provider: "claude-sub",
        window: "weekly",
        usedPct: 99,
        resetsAt: new Date(ms + 6 * 86_400_000).toISOString(),
        source: "test",
        takenAt: new Date(ms - 7 * 3_600_000).toISOString(),
        confidence: "high",
      },
    ]);
    const { runs } = wire();
    const dispatcher = new BuildDispatcher(tracker, runStore, runs, now, quota);
    await inReady("A");
    expect(await dispatcher.next(projectId)).not.toBeNull();
  });

  it("GivenTheSameIdleDecision_WhenNextRunsAgain_ThenItsTimeStaysWhenItBegan", async () => {
    await tracker.updateProject(projectId, { paused: true });
    const { dispatcher } = wire();
    await dispatcher.next(projectId);
    const first = (await tracker.getProject(projectId))!.lastDispatch;
    await dispatcher.next(projectId);
    expect((await tracker.getProject(projectId))!.lastDispatch).toEqual(first);
  });

  it("GivenNoReadyTicket_WhenNext_ThenNothingReadyIsRecorded", async () => {
    const { dispatcher } = wire();
    await dispatcher.next(projectId);
    expect(await decision()).toBe("nothing_ready");
  });

  it("GivenTheGlobalCapIsFull_WhenARunEndsElsewhere_ThenTheWaitingProjectStarts", async () => {
    await tracker.updateProject(projectId, { runsAtOnce: MAX_ACTIVE_RUNS_GLOBAL });
    host = new InMemoryCodeHost([REPO, { ...REPO, fullName: "albernhagen/b" }]);
    const { dispatcher, runs } = wire();
    const started: Run[] = [];
    for (let i = 0; i < MAX_ACTIVE_RUNS_GLOBAL; i++) await inReady(`A${i}`);
    await dispatcher.next(projectId);
    for (const r of await runStore.listActive(projectId)) started.push(r);
    expect(started).toHaveLength(MAX_ACTIVE_RUNS_GLOBAL);

    const b = await tracker.createProject({ name: "B", key: "B", repos: ["albernhagen/b"] });
    await tracker.updateProject(b.id, { autoBuild: true, buildEnabled: true });
    const t = await tracker.createTicket(b.id, ready("B1"), "andy");
    await tracker.updateTicket(
      b.id,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
    expect(await dispatcher.next(b.id)).toBeNull();
    expect(await decision(b.id)).toBe("global_cap");

    await succeed(runs, started[0]!);
    await dispatcher.wakeGlobalCapWaiters(projectId);
    expect(await runStore.listActive(b.id)).toHaveLength(1);
  });

  it("GivenATicketAtItsBuildCap_WhenNext_ThenItIsFlaggedNotStarted", async () => {
    const { dispatcher } = wire();
    const t = await inReady("Capped");
    for (let i = 0; i < MAX_BUILD_RUNS_PER_TICKET; i++) {
      const run = await runStore.create({
        projectId,
        ticketId: t.id,
        step: "build",
        route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
        tier: "fast",
        deadline: null,
      });
      await runStore.update(
        run.id,
        { status: "failed", executor: { repo: REPO.fullName, ref: "r", externalId: `${i}` } },
        ["queued"],
      );
    }
    expect(await dispatcher.next(projectId)).toBeNull();
    expect((await tracker.getTicket(projectId, t.id))!.needsAttention).toBe(true);
  });

  it("GivenBuildsNotEnabled_WhenNext_ThenNothingStartsEvenWithAutoBuildOn", async () => {
    await tracker.updateProject(projectId, { buildEnabled: false });
    const { dispatcher } = wire();
    const t = await inReady("Board");
    expect(await dispatcher.next(projectId)).toBeNull();
    expect(await builds(t.id)).toEqual([]);
  });

  it("GivenBuildsNotEnabled_WhenAndyTurnsAutoBuildOn_ThenItIsRefused", async () => {
    await tracker.updateProject(projectId, { autoBuild: false, buildEnabled: false });
    const { projects } = wire();
    await expect(projects.update(projectId, { autoBuild: true }, OWNER)).rejects.toMatchObject({
      code: "not_buildable",
    });
  });

  it("GivenBuildsOn_WhenAndyTurnsThemOff_ThenWhoAndWhenAreRecordedAndAutoBuildGoesOffToo", async () => {
    const { projects } = wire();
    const off = await projects.update(projectId, { buildEnabled: false }, OWNER);
    expect(off).toMatchObject({
      buildEnabled: false,
      autoBuild: false,
      buildEnabledBy: "andy@example.com",
    });
    expect(off.buildEnabledAt).not.toBeNull();
  });

  it("GivenNoExecutor_WhenNext_ThenNothingStartsAndNothingThrows", async () => {
    const { dispatcher } = wire(null);
    await inReady("Board");
    expect(await dispatcher.next(projectId)).toBeNull();
  });

  it("GivenAWaitingReadyTicket_WhenAutoBuildIsTurnedOn_ThenItsBuildStarts", async () => {
    await tracker.updateProject(projectId, { autoBuild: false });
    const { projects } = wire();
    const t = await inReady("Board");
    await projects.update(projectId, { autoBuild: true }, OWNER);
    expect(await builds(t.id)).toHaveLength(1);
  });

  /** M4.6: Just-in-time re-planning when a story unblocks (`workflow.md` §4.4). */
  describe("just-in-time re-planning", () => {
    const planOutput = { summary: "Adds the board page.", plan: buildOutput.plan };
    const toStage = (id: string, to: "done" | "in_progress") =>
      tracker.updateTicket(projectId, id, { stage: { to, forced: true, reason: null } }, "andy");
    const report = async (runs: RunService, run: Run) => {
      await runs.context(run.id, run.executor!);
      await succeed(runs, run, { output: run.step === "plan" ? planOutput : buildOutput });
    };
    const approve = (planId: string) =>
      runStore.update(
        planId,
        {
          planDecision: {
            decision: "approved",
            reason: null,
            by: OWNER.email,
            at: now().toISOString(),
          },
        },
        ["succeeded"],
      );
    const unflag = (id: string) =>
      tracker.updateTicket(projectId, id, { fields: { needsAttention: false } }, "andy");
    const comments = async (id: string) =>
      (await tracker.listEvents(projectId, id)).filter((e) => e.kind === "comment");

    /**
     * Story blocked by a Done blocker, planned and approved (its build waited); then, when
     * `blockerDoneAgain`, the blocker is reopened and reaches Done again after the plan.
     */
    async function approvedPlan(blockerDoneAgain: boolean, planApproval: PlanApproval = "all") {
      await tracker.updateProject(projectId, { planApproval });
      const wired = wire();
      const blocker = await tracker.createTicket(projectId, ready("Blocker"), "andy");
      await toStage(blocker.id, "done");
      const story = await inReady("Story", { blockedBy: [blocker.key] });
      const plan = await wired.runs.start(projectId, story.id, "plan");
      await report(wired.runs, plan);
      await approve(plan.id);
      await unflag(story.id);
      if (blockerDoneAgain) {
        await toStage(blocker.id, "in_progress");
        await toStage(blocker.id, "done");
      }
      return { ...wired, blocker, story, plan };
    }

    it("GivenAPlanOlderThanItsBlockersDone_WhenNext_ThenAPlanRunStartsAndTheTimelineNamesTheBlocker", async () => {
      const { dispatcher, blocker, story, plan } = await approvedPlan(true);
      const run = await dispatcher.next(projectId);
      expect(run).toMatchObject({ step: "plan", ticketId: story.id });
      expect(run!.id).not.toBe(plan.id);
      expect(await builds(story.id)).toEqual([]);
      const notes = (await comments(story.id)).map((e) => e.body);
      expect(notes).toContain(`Plan re-run: ${blocker.key} merged after the plan.`);
    });

    it("GivenAReRunPlan_WhenItIsReported_ThenTheTicketWaitsForApprovalAndBuildsOnTheNewPlan", async () => {
      const { runs, dispatcher, story } = await approvedPlan(true);
      const replan = (await dispatcher.next(projectId))!;
      await report(runs, replan);
      expect((await tracker.getTicket(projectId, story.id))!.needsAttention).toBe(true);
      await unflag(story.id);
      // Awaiting Andy's decision: nothing starts, and the new plan is newer than the blocker.
      expect(await dispatcher.next(projectId)).toBeNull();
      const { build } = await runs.decidePlan(
        projectId,
        story.id,
        replan.id,
        { decision: "approved" },
        OWNER,
      );
      expect(build).toMatchObject({ step: "build", planRunId: replan.id });
    });

    it("GivenABlockerDoneWhileThePlanTaskRan_WhenNext_ThenThePlanIsReRun", async () => {
      await tracker.updateProject(projectId, { planApproval: "all" });
      const { runs, dispatcher } = wire();
      const blocker = await tracker.createTicket(projectId, ready("Blocker"), "andy");
      await toStage(blocker.id, "done");
      const story = await inReady("Story", { blockedBy: [blocker.key] });
      const plan = await runs.start(projectId, story.id, "plan");
      // The plan task starts reading; the blocker is reopened and merged again before it ends.
      await runs.context(plan.id, plan.executor!);
      await toStage(blocker.id, "in_progress");
      await toStage(blocker.id, "done");
      await succeed(runs, plan, { output: planOutput });
      await approve(plan.id);
      await unflag(story.id);
      expect(await dispatcher.next(projectId)).toMatchObject({ step: "plan", ticketId: story.id });
    });

    it("GivenAPlanNewerThanEveryBlockersDone_WhenNext_ThenTheBuildStartsWithThePlan", async () => {
      const { dispatcher, story, plan } = await approvedPlan(false);
      expect(await dispatcher.next(projectId)).toMatchObject({
        step: "build",
        ticketId: story.id,
        planRunId: plan.id,
      });
      const notes = (await comments(story.id)).map((e) => e.body ?? "");
      expect(notes.some((b) => b.startsWith("Plan re-run"))).toBe(false);
    });

    it("GivenPolicyNoneAndAPlanOlderThanItsBlockersDone_WhenNext_ThenThePlanIsReRunNotBuilt", async () => {
      // Under "none" a plan exists only when Andy asked for one; it is re-run too.
      const { dispatcher, story } = await approvedPlan(true, "none");
      expect(await dispatcher.next(projectId)).toMatchObject({ step: "plan", ticketId: story.id });
    });

    it("GivenNoBlockersAndAnApprovedPlan_WhenNext_ThenTheBuildStartsAsBefore", async () => {
      await tracker.updateProject(projectId, { planApproval: "all" });
      const { runs, dispatcher } = wire();
      const story = await inReady("Story");
      const plan = await runs.start(projectId, story.id, "build");
      await report(runs, plan);
      await approve(plan.id);
      await unflag(story.id);
      expect(await dispatcher.next(projectId)).toMatchObject({
        step: "build",
        planRunId: plan.id,
      });
    });

    it("GivenABlockerInAnotherProjectDoneAfterThePlan_WhenItMerges_ThenThePlanIsReRun", async () => {
      await tracker.updateProject(projectId, { planApproval: "all" });
      const { runs, tickets } = wire();
      const ops = await tracker.createProject({ name: "Ops", key: "OPS", repos: [] });
      const blocker = await tracker.createTicket(ops.id, ready("Ops"), "andy");
      await tracker.updateTicket(
        ops.id,
        blocker.id,
        { stage: { to: "done", forced: true, reason: null } },
        "andy",
      );
      const story = await inReady("Story", { blockedBy: [blocker.key] });
      const plan = await runs.start(projectId, story.id, "plan");
      await report(runs, plan);
      await approve(plan.id);
      await unflag(story.id);
      await tracker.updateTicket(
        ops.id,
        blocker.id,
        { stage: { to: "ready_for_review", forced: true, reason: null } },
        "andy",
      );
      // AI-96: the blocker's merge wakes this project's dispatcher.
      await tickets.followPullRequest(ops.id, blocker.id, "done", "PR merged");
      const [latest] = await runStore.listForTicket(projectId, story.id);
      expect(latest).toMatchObject({ step: "plan", status: "queued" });
      expect(latest!.id).not.toBe(plan.id);
      const notes = (await comments(story.id)).map((e) => e.body);
      expect(notes).toContain(`Plan re-run: ${blocker.key} merged after the plan.`);
    });

    it("GivenBlockerDoneTimesUnreadable_WhenNext_ThenTheTicketWaitsAndOthersStill", async () => {
      const { dispatcher, story } = await approvedPlan(true);
      const free = await inReady("Free");
      vi.spyOn(tracker, "listEvents").mockRejectedValue(new Error("unavailable"));
      expect(await dispatcher.next(projectId)).toMatchObject({ ticketId: free.id });
      expect(await runStore.listForTicket(projectId, story.id)).toHaveLength(1);
    });

    it("GivenTheReplanNoteFailsToWrite_WhenNext_ThenThePlanRunStillStarts", async () => {
      const { dispatcher, story } = await approvedPlan(true);
      const add = tracker.addComment.bind(tracker);
      vi.spyOn(tracker, "addComment").mockImplementation((p, t, body, actor) =>
        body.startsWith("Plan re-run")
          ? Promise.reject(new Error("unavailable"))
          : add(p, t, body, actor),
      );
      expect(await dispatcher.next(projectId)).toMatchObject({ step: "plan", ticketId: story.id });
    });

    it("GivenAnOutdatedPlanAtThePlanCap_WhenNext_ThenTheTicketIsFlaggedNotReplanned", async () => {
      const { runs, dispatcher, blocker, story } = await approvedPlan(false);
      let latest: Run | undefined;
      for (let i = 1; i < MAX_PLAN_RUNS_PER_TICKET; i++) {
        latest = await runs.start(projectId, story.id, "plan");
        await report(runs, latest);
      }
      await approve(latest!.id);
      await unflag(story.id);
      await toStage(blocker.id, "in_progress");
      await toStage(blocker.id, "done");
      expect(await dispatcher.next(projectId)).toBeNull();
      expect((await tracker.getTicket(projectId, story.id))!.needsAttention).toBe(true);
    });
  });

  describe("night budget (M4.18)", () => {
    let nights: InMemoryNightLaunchStore;
    beforeEach(() => {
      nights = new InMemoryNightLaunchStore();
    });

    const BUDGET = { maxRuns: 10, maxTokens: 1_000_000, maxUsd: 50 };
    /** A running launch over `stories`, started now, stopping in an hour unless `stopAt`. */
    const launch = async (
      stories: { key: string }[],
      over: { budget?: Partial<NightLaunch["budget"]>; stopAt?: string } = {},
    ) => {
      const epic = await tracker.createTicket(projectId, { type: "epic", title: "Night" }, "andy");
      const at = new Date(ms).toISOString();
      return nights.create({
        id: "launch-1",
        projectId,
        epicId: epic.id,
        epicKey: epic.key,
        budget: { ...BUDGET, ...over.budget },
        stopAt: over.stopAt ?? new Date(ms + 3_600_000).toISOString(),
        status: "running",
        storyKeys: stories.map((t) => t.key),
        createdAt: at,
        createdBy: "user:andy",
        startedAt: at,
        endedAt: null,
        endReason: null,
      });
    };
    const holds = () =>
      vi
        .mocked(console.log)
        .mock.calls.map(([line]) => JSON.parse(String(line)))
        .filter((l) => l.message === "build waits: night launch stopped dispatching");

    it("GivenALaunchAtItsMaxAgentTasks_WhenNext_ThenItsStoryWaitsAndTheLaunchIdAndLimitAreLogged", async () => {
      const { dispatcher } = wire(undefined, nights);
      const a = await inReady("A");
      const b = await inReady("B");
      await launch([a, b], { budget: { maxRuns: 1 } });
      await tracker.updateProject(projectId, { runsAtOnce: 1 });
      expect((await dispatcher.next(projectId))?.ticketId).toBe(a.id);
      await tracker.updateProject(projectId, { runsAtOnce: 2 });

      expect(await dispatcher.next(projectId)).toBeNull();
      expect(await builds(b.id)).toEqual([]);
      expect(holds()).toContainEqual(
        expect.objectContaining({ ticket: b.key, launchId: "launch-1", limit: "max_runs" }),
      );
      expect((await nights.get("launch-1"))!.status).toBe("stopping");
    });

    // 1,000 in and 200 out: about $0.004 at Sonnet's API rates.
    const USAGE = {
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      turns: 3,
      wallMs: 1000,
    };
    it.each([
      ["max_tokens", { maxTokens: 1000 }],
      ["max_usd", { maxUsd: 0.003 }],
    ] as const)(
      "GivenAFinishedTaskOverThe%sBudget_WhenItEnds_ThenTheLaunchEndsAndTheRestIsFlagged",
      async (limit, budget) => {
        await tracker.updateProject(projectId, { runsAtOnce: 1 });
        const { dispatcher, runs } = wire(undefined, nights);
        const a = await inReady("A");
        const b = await inReady("B");
        await launch([a, b], { budget });
        const run = (await dispatcher.next(projectId))!;
        await runs.context(run.id, run.executor!);
        // 1,200 tokens and an estimated cost: the report wakes the dispatcher, which ends it.
        await succeed(runs, run, { usage: USAGE });

        expect(await builds(b.id)).toEqual([]);
        expect(await nights.get("launch-1")).toMatchObject({ status: "ended", endReason: limit });
        const flagged = (await tracker.getTicket(projectId, b.id))!;
        expect(flagged.needsAttention).toBe(true);
        const comments = await tracker.listEvents(projectId, b.id);
        expect(JSON.stringify(comments)).toContain("Night launch of");
      },
    );

    it("GivenAStoppingLaunchWithATaskInFlight_WhenNext_ThenItWaitsToEndUntilTheTaskFinishes", async () => {
      await tracker.updateProject(projectId, { runsAtOnce: 1 });
      const { dispatcher, runs } = wire(undefined, nights);
      const a = await inReady("A");
      const b = await inReady("B");
      await launch([a, b], { budget: { maxRuns: 1 } });
      const run = (await dispatcher.next(projectId))!;
      await tracker.updateProject(projectId, { runsAtOnce: 2 });
      await dispatcher.next(projectId);
      expect((await nights.get("launch-1"))!.status).toBe("stopping");

      await runs.context(run.id, run.executor!);
      await succeed(runs, run);
      expect(await nights.get("launch-1")).toMatchObject({
        status: "ended",
        endReason: "max_runs",
      });
      expect((await tracker.getTicket(projectId, b.id))!.needsAttention).toBe(true);
      expect(await builds(b.id)).toEqual([]);
    });

    it("GivenALaunchPastItsStopTime_WhenNext_ThenNoStoryStartsAndTheLaunchEnds", async () => {
      const { dispatcher } = wire(undefined, nights);
      const a = await inReady("A");
      await launch([a], { stopAt: new Date(ms + 500).toISOString() });

      expect(await dispatcher.next(projectId)).toBeNull();
      expect(await builds(a.id)).toEqual([]);
      expect(await nights.get("launch-1")).toMatchObject({
        status: "ended",
        endReason: "stop_time",
      });
      expect((await tracker.getTicket(projectId, a.id))!.needsAttention).toBe(true);
    });

    it("GivenATicketOutsideTheLaunch_WhenTheLaunchIsAtItsLimit_ThenItStartsAsToday", async () => {
      const { dispatcher } = wire(undefined, nights);
      const story = await inReady("Story");
      const other = await inReady("Other");
      await launch([story], { stopAt: new Date(ms + 500).toISOString() });

      expect((await dispatcher.next(projectId))?.ticketId).toBe(other.id);
      expect(await builds(story.id)).toEqual([]);
    });

    it("GivenALaunchWithBudgetLeft_WhenNext_ThenItsStoriesStartAsToday", async () => {
      const { dispatcher } = wire(undefined, nights);
      const a = await inReady("A");
      await launch([a]);
      expect((await dispatcher.next(projectId))?.ticketId).toBe(a.id);
      expect((await nights.get("launch-1"))!.status).toBe("running");
    });

    it.each([
      ["paused", { paused: true }, "paused"],
      ["Builds off", { buildEnabled: false }, null],
    ] as const)(
      "GivenALaunchWithBudgetLeftAnd%s_WhenNext_ThenNothingStarts",
      async (_, change, recorded) => {
        const { dispatcher } = wire(undefined, nights);
        const a = await inReady("A");
        await launch([a]);
        await tracker.updateProject(projectId, change);

        expect(await dispatcher.next(projectId)).toBeNull();
        expect(await builds(a.id)).toEqual([]);
        if (recorded) expect(await decision()).toBe(recorded);
      },
    );

    it("GivenAndyStoppedTheLaunch_WhenNext_ThenItsStoriesWaitAndItEndsStopped", async () => {
      const { dispatcher } = wire(undefined, nights);
      const a = await inReady("A");
      await launch([a]);
      await nights.transition("launch-1", ["running"], { status: "stopping" });

      expect(await dispatcher.next(projectId)).toBeNull();
      expect(await builds(a.id)).toEqual([]);
      expect(await nights.get("launch-1")).toMatchObject({ status: "ended", endReason: "stopped" });
    });

    it("GivenEveryStoryDone_WhenNext_ThenTheLaunchEndsDoneAndNothingIsFlagged", async () => {
      const { dispatcher } = wire(undefined, nights);
      const a = await inReady("A");
      await tracker.updateTicket(
        projectId,
        a.id,
        { stage: { to: "done", forced: true, reason: null } },
        "andy",
      );
      await launch([a]);

      await dispatcher.next(projectId);
      expect(await nights.get("launch-1")).toMatchObject({ status: "ended", endReason: "done" });
      expect((await tracker.getTicket(projectId, a.id))!.needsAttention).toBe(false);
    });
  });
});
