import {
  Assumption,
  InMemoryCodeHost,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type Executor,
  type Run,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectService } from "./projects";
import { RefineDispatcher } from "./refine-dispatch";
import { MAX_REFINE_RUNS_PER_TICKET, RunService } from "./runs";
import { WorkflowExecutor } from "./test-executor";
import { TicketService } from "./tickets";

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};

const question = (text: string) => ({
  question: text,
  assumption: `Assume ${text}`,
  options: [],
  context: "Context for the question.",
  recommendation: { answer: "yes", reason: "the simplest" },
  cost: "direction",
  confidence: "unsure",
  urgency: "normal",
});
const output = {
  summary: "**Ask**: a board",
  type: "feature",
  size: "S",
  sizeReason: "one screen",
  risk: "low",
  riskReason: "small",
  confidence: "high",
  confidenceReason: "clear",
  outOfScope: [],
  touches: ["apps/web/**"],
  body: null,
  acceptanceCriteria: [],
  outcome: "ready",
  reason: null,
  children: [],
  gaps: [question("A?"), question("B?")],
};
/** Everything the Definition of Ready needs except what refine proposes (type, size). */
const clear = {
  title: "Board",
  body: "Andy can't see his tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
};

describe("RefineDispatcher", () => {
  let tracker: InMemoryWorkTracker;
  let runStore: InMemoryRunStore;
  let host: InMemoryCodeHost;
  let projectId: string;

  // A clock that ticks, so runs are ordered by createdAt.
  let ms: number;
  const now = () => new Date((ms += 1000));

  function wire(executor: Executor | null = new WorkflowExecutor(host)) {
    const runs: RunService = new RunService(tracker, runStore, executor, now, null, async (p) => {
      await dispatcher.next(p);
    });
    const dispatcher = new RefineDispatcher(tracker, runStore, runs, now);
    const next = (p: string) => dispatcher.next(p);
    return {
      runs,
      dispatcher,
      tickets: new TicketService(tracker, runs, next),
      projects: new ProjectService(tracker, null, next),
    };
  }

  const refines = async (ticketId: string) =>
    (await runStore.listForTicket(projectId, ticketId)).filter((r) => r.step === "refine");

  /** The executor run calls back: fetches its prompt, then reports. */
  async function finish(runs: RunService, run: Run, result: object = { output }) {
    const caller = (await runStore.get(run.id))!.executor!;
    await runs.context(run.id, caller);
    return runs.report(run.id, caller, {
      status: "succeeded",
      summary: null,
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0,
      ...result,
    });
  }

  async function answerAll(tickets: TicketService, ticketId: string) {
    for (const q of await tracker.listQuestions({ ticketId, status: "open" })) {
      await tickets.answer(q.id, "yes", "ui", "andy");
    }
  }

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    ms = Date.parse("2026-11-04T12:00:00.000Z");
    tracker = new InMemoryWorkTracker(now);
    runStore = new InMemoryRunStore(now);
    host = new InMemoryCodeHost([REPO]);
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
  });

  it("GivenAPausedProject_WhenATicketEntersUpNext_ThenNoRefineStarts", async () => {
    await tracker.updateProject(projectId, { paused: true });
    const { tickets } = wire();
    const ticket = await tickets.create(projectId, { type: "feature", title: "Board" }, "andy", {
      upNext: true,
    });
    expect(await refines(ticket.id)).toEqual([]);
  });

  it("GivenAutoRefineOn_WhenATicketEntersUpNext_ThenARefineRunStartsWithoutAndy", async () => {
    const { tickets } = wire();
    const ticket = await tickets.create(projectId, { type: "feature", title: "Board" }, "andy", {
      upNext: true,
    });
    const [run] = await refines(ticket.id);
    expect(run).toMatchObject({ status: "queued", executor: expect.anything() });
    expect(host.workflowRuns.size).toBe(1);
  });

  it("GivenARefineInFlight_WhenMoreTicketsEnterUpNext_ThenTheyWaitAndStartOldestFirstAsRunsEnd", async () => {
    const { tickets, runs } = wire();
    const first = await tickets.create(projectId, { type: "feature", title: "One" }, "andy", {
      upNext: true,
    });
    const second = await tickets.create(projectId, { type: "feature", title: "Two" }, "andy", {
      upNext: true,
    });
    const third = await tickets.create(projectId, { type: "feature", title: "Three" }, "andy", {
      upNext: true,
    });
    expect(await refines(second.id)).toEqual([]);

    await finish(runs, (await refines(first.id))[0]!);
    expect(await refines(second.id)).toHaveLength(1);
    expect(await refines(third.id)).toEqual([]);

    await finish(runs, (await refines(second.id))[0]!);
    expect(await refines(third.id)).toHaveLength(1);
    expect((await refines(first.id)).length).toBe(1);
  });

  it("GivenRefineAskedQuestions_WhenAndyAnswersAllAndTheDorIsMet_ThenTheTicketIsReadyAndNoRunStarts", async () => {
    const { tickets, runs } = wire();
    const ticket = await tickets.create(projectId, clear, "andy", { upNext: true });
    await finish(runs, (await refines(ticket.id))[0]!);
    expect(await tracker.getTicket(projectId, ticket.id)).toMatchObject({
      needsAttention: true,
      type: "feature",
      size: "S",
    });

    await answerAll(tickets, ticket.id);
    expect(await tracker.getTicket(projectId, ticket.id)).toMatchObject({
      stage: "ready",
      needsAttention: false,
    });
    expect(await refines(ticket.id)).toHaveLength(1);
  });

  it("GivenRefineAskedQuestions_WhenAndyAnswersAllAndTheDorIsStillUnmet_ThenRefineRunsAgainWithTheAnswers", async () => {
    const { tickets, runs } = wire();
    const ticket = await tickets.create(projectId, { type: "feature", title: "Board" }, "andy", {
      upNext: true,
    });
    await finish(runs, (await refines(ticket.id))[0]!);
    const [q] = await tracker.listQuestions({ ticketId: ticket.id, status: "open" });
    await tickets.answer(q!.id, "yes", "ui", "andy");
    expect(await refines(ticket.id)).toHaveLength(1);

    await answerAll(tickets, ticket.id);
    const again = await refines(ticket.id);
    expect(again).toHaveLength(2);
    expect(again[0]?.prompt).toContain('"answer": "yes"');
  });

  it("GivenTheRefineCapIsReached_WhenTheDorIsStillUnmet_ThenTheTicketNeedsYouWithTheGapsAndNoRunStarts", async () => {
    const { tickets, runs } = wire();
    const ticket = await tickets.create(projectId, { type: "feature", title: "Board" }, "andy", {
      upNext: true,
    });
    for (let i = 0; i < MAX_REFINE_RUNS_PER_TICKET; i++) {
      await finish(runs, (await refines(ticket.id))[0]!);
      await answerAll(tickets, ticket.id);
    }
    expect(await refines(ticket.id)).toHaveLength(MAX_REFINE_RUNS_PER_TICKET);
    expect(await tracker.getTicket(projectId, ticket.id)).toMatchObject({
      stage: "backlog",
      needsAttention: true,
    });
    const last = (await tracker.listEvents(projectId, ticket.id)).findLast(
      (e) => e.kind === "comment",
    );
    expect(last).toMatchObject({
      actor: "system",
      body: expect.stringContaining("problem/intent"),
    });
  });

  it("GivenARefineFailed_WhenTheNextRunIsDispatched_ThenItIsNotRetriedAndTheTicketNeedsYou", async () => {
    const { tickets, runs } = wire();
    const failed = await tickets.create(projectId, { type: "feature", title: "One" }, "andy", {
      upNext: true,
    });
    await finish(runs, (await refines(failed.id))[0]!, { output: { summary: "no questions" } });
    expect((await refines(failed.id))[0]?.status).toBe("failed");
    expect((await tracker.getTicket(projectId, failed.id))?.needsAttention).toBe(true);

    const next = await tickets.create(projectId, { type: "feature", title: "Two" }, "andy", {
      upNext: true,
    });
    expect(await refines(next.id)).toHaveLength(1);
    expect(await refines(failed.id)).toHaveLength(1);
  });

  it("GivenTheWatchdogEndsARefine_WhenItsRetryEndsToo_ThenTheNextTicketStarts", async () => {
    const { tickets, runs } = wire();
    const first = await tickets.create(projectId, { type: "feature", title: "One" }, "andy", {
      upNext: true,
    });
    const second = await tickets.create(projectId, { type: "feature", title: "Two" }, "andy", {
      upNext: true,
    });
    const pastDeadline = () => (ms += 46 * 60_000);

    pastDeadline();
    expect(await runs.checkDeadline((await refines(first.id))[0]!.id)).toBe("retried");
    expect(await refines(second.id)).toEqual([]);

    pastDeadline();
    expect(await runs.checkDeadline((await refines(first.id))[0]!.id)).toBe("flagged");
    expect(await refines(second.id)).toHaveLength(1);
  });

  it("GivenARefineInFlight_WhenItsTicketIsCancelled_ThenTheNextTicketStarts", async () => {
    const { tickets } = wire();
    const first = await tickets.create(projectId, { type: "feature", title: "One" }, "andy", {
      upNext: true,
    });
    const second = await tickets.create(projectId, { type: "feature", title: "Two" }, "andy", {
      upNext: true,
    });
    expect(await refines(second.id)).toEqual([]);

    await tickets.cancel(projectId, first.id, "andy");
    expect((await refines(first.id))[0]?.status).toBe("cancelled");
    expect(await refines(second.id)).toHaveLength(1);
  });

  it("GivenCancelledAndArchivedTickets_WhenAutoRefineTurnsOn_ThenNeitherIsRefined", async () => {
    const { tickets, projects } = wire();
    await projects.update(projectId, { autoRefine: false }, "andy@example.com");
    const cancelled = await tickets.create(projectId, { type: "feature", title: "One" }, "andy", {
      upNext: true,
    });
    await tickets.cancel(projectId, cancelled.id, "andy");
    const archived = await tickets.create(projectId, { type: "feature", title: "Two" }, "andy", {
      upNext: true,
    });
    // Archived while in Backlog (e.g. reopened after archiving): still hidden, still skipped.
    await tracker.updateTicket(projectId, archived.id, { fields: { archived: true } }, "andy");

    await projects.update(projectId, { autoRefine: true }, "andy@example.com");
    expect(await refines(cancelled.id)).toEqual([]);
    expect(await refines(archived.id)).toEqual([]);
  });

  it("GivenAutoRefineOff_WhenATicketEntersUpNext_ThenNoRunStartsUntilItIsTurnedOn", async () => {
    const { tickets, projects } = wire();
    await projects.update(projectId, { autoRefine: false }, "andy@example.com");
    const ticket = await tickets.create(projectId, { type: "feature", title: "Board" }, "andy", {
      upNext: true,
    });
    expect(await refines(ticket.id)).toEqual([]);

    await projects.update(projectId, { autoRefine: true }, "andy@example.com");
    expect(await refines(ticket.id)).toHaveLength(1);
  });

  it("GivenNoExecutor_WhenATicketEntersUpNext_ThenTheTicketIsCreatedAndNoRunStarts", async () => {
    const { tickets } = wire(null);
    const ticket = await tickets.create(projectId, { type: "feature", title: "Board" }, "andy", {
      upNext: true,
    });
    expect(ticket.key).toBe("AI-1");
    expect(await runStore.listActive(projectId)).toEqual([]);
  });

  it("GivenTheDispatchFails_WhenATicketEntersUpNext_ThenTheTicketIsCreatedAndNeedsYouWithTheReason", async () => {
    host = new InMemoryCodeHost([]);
    const { tickets } = wire();
    const ticket = await tickets.create(projectId, { type: "feature", title: "Board" }, "andy", {
      upNext: true,
    });
    expect(await tracker.getTicket(projectId, ticket.id)).toMatchObject({ needsAttention: true });
    const last = (await tracker.listEvents(projectId, ticket.id)).findLast(
      (e) => e.kind === "comment",
    );
    expect(last?.body).toMatch(/^Refine couldn't start/);

    // Flagged: the next event doesn't try it again.
    await tickets.create(projectId, { type: "feature", title: "Two" }, "andy", { upNext: true });
    expect(await refines(ticket.id)).toHaveLength(1);
  });

  it("GivenAStoreError_WhenDispatching_ThenItIsLoggedAndNotThrown", async () => {
    const { dispatcher } = wire();
    tracker.listTickets = async () => {
      throw new Error("firestore down");
    };
    await expect(dispatcher.next(projectId)).resolves.toBeNull();
  });
  describe("askHeld (AI-75)", () => {
    async function heldTicket() {
      const t = await tracker.createTicket(projectId, { title: "Board" }, "andy");
      const run = `run-${t.key}`;
      await tracker.updateTicket(
        projectId,
        t.id,
        {
          fields: {
            upNextRank: "0000000001",
            refineAssumptions: [
              Assumption.parse({
                id: `${run}-a1`,
                text: "assume",
                question: "Which?",
                cost: "scope",
                confidence: "unsure",
                demotedBy: "daily_cap",
                runId: run,
                createdAt: now().toISOString(),
              }),
            ],
          },
        },
        "system",
      );
      return t;
    }

    it("GivenAHeldGapAndAutoRefineOff_WhenAskHeldRuns_ThenItIsAskedWithoutARun", async () => {
      const { dispatcher } = wire(null);
      const t = await heldTicket();
      await tracker.updateProject(projectId, { autoRefine: false });
      expect(await dispatcher.askHeld(projectId)).toBe(1);
      expect(await tracker.listQuestions({ ticketId: t.id, status: "open" })).toHaveLength(1);
      expect(await refines(t.id)).toEqual([]);
    });

    it("GivenTwoHeldTicketsAndOneDailySlot_WhenTwoEventsAskAtOnce_ThenOnlyOneQuestionIsAsked", async () => {
      const { dispatcher } = wire();
      await tracker.updateProject(projectId, { dailyQuestionCap: 1 });
      const a = await heldTicket();
      const b = await heldTicket();
      // A slow ask: the other event reads the daily room before the first question exists.
      const ask = tracker.askQuestions.bind(tracker);
      vi.spyOn(tracker, "askQuestions").mockImplementation(async (...args) => {
        await new Promise((r) => setTimeout(r, 10));
        return ask(...args);
      });
      await Promise.all([dispatcher.askHeld(projectId), dispatcher.askHeld(projectId)]);
      const open = await tracker.listQuestions({ projectId, status: "open" });
      expect(open).toHaveLength(1);
      expect([a.id, b.id]).toContain(open[0]!.ticketId);
    });

    it("GivenAPausedProject_WhenAskHeldRuns_ThenNothingIsAsked", async () => {
      const { dispatcher } = wire();
      const t = await heldTicket();
      await tracker.updateProject(projectId, { paused: true });
      expect(await dispatcher.askHeld(projectId)).toBe(0);
      expect(await tracker.listQuestions({ ticketId: t.id })).toEqual([]);
    });
  });
});
