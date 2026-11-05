import {
  InMemoryCodeHost,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type Executor,
  type NewTicket,
  type Run,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildDispatcher } from "./build-dispatch";
import { MAX_BUILD_RUNS_PER_TICKET, MAX_TICKETS_IN_FLIGHT, branchFor } from "./builds";
import { ProjectService } from "./projects";
import { RunService, type RunResult } from "./runs";
import { WorkflowExecutor, buildOutput } from "./test-executor";
import { TicketService } from "./tickets";

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};

/** A ticket that meets the Definition of Ready. */
const ready = (title: string, extra: Partial<NewTicket> = {}): NewTicket => ({
  type: "feature",
  title,
  body: "Andy can't see his tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
  size: "S",
  sizeReason: "one screen",
  ...extra,
});

describe("BuildDispatcher", () => {
  let tracker: InMemoryWorkTracker;
  let runStore: InMemoryRunStore;
  let host: InMemoryCodeHost;
  let projectId: string;
  let ms: number;
  const now = () => new Date((ms += 1000));

  function wire(executor: Executor | null = new WorkflowExecutor(host)) {
    const runs: RunService = new RunService(tracker, runStore, executor, now, null, async (p) => {
      await dispatcher.next(p);
    });
    const dispatcher = new BuildDispatcher(tracker, runStore, runs, now);
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
    await tracker.updateProject(projectId, { autoRefine: false, autoBuild: true });
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

  it("GivenTooManyTicketsWaitingForReview_WhenNext_ThenDispatchPauses", async () => {
    const { dispatcher } = wire();
    for (let i = 0; i < MAX_TICKETS_IN_FLIGHT; i++) {
      const t = await tracker.createTicket(projectId, ready(`Built ${i}`), "andy");
      await tracker.updateTicket(
        projectId,
        t.id,
        { stage: { to: "ready_for_review", forced: true, reason: null } },
        "andy",
      );
    }
    await inReady("Waiting");
    expect(await dispatcher.next(projectId)).toBeNull();
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

  it("GivenNoExecutor_WhenNext_ThenNothingStartsAndNothingThrows", async () => {
    const { dispatcher } = wire(null);
    await inReady("Board");
    expect(await dispatcher.next(projectId)).toBeNull();
  });

  it("GivenAWaitingReadyTicket_WhenAutoBuildIsTurnedOn_ThenItsBuildStarts", async () => {
    await tracker.updateProject(projectId, { autoBuild: false });
    const { projects } = wire();
    const t = await inReady("Board");
    await projects.update(projectId, { autoBuild: true });
    expect(await builds(t.id)).toHaveLength(1);
  });
});
