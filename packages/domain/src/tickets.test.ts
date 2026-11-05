import { InMemoryWorkTracker, type NewTicket } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError, RECENT_EVENTS, TicketService } from "./tickets";

const readyStory: NewTicket = {
  type: "story",
  title: "Board",
  body: "Andy can't see tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  size: "S",
  sizeReason: "one screen",
  tier: "strong",
};

describe("TicketService", () => {
  let tracker: InMemoryWorkTracker;
  let service: TicketService;
  let projectId: string;

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    service = new TicketService(tracker);
    projectId = (await tracker.createProject({ name: "AI", key: "AI" })).id;
  });

  const rejects = (p: Promise<unknown>, code: DomainError["code"]) =>
    expect(p).rejects.toMatchObject({ name: "DomainError", code });

  it("GivenACompleteStory_WhenCreated_ThenDorMet", async () => {
    expect((await service.create(projectId, readyStory, "andy")).dorStatus).toBe("met");
    expect((await service.create(projectId, { type: "task", title: "x" }, "andy")).dorStatus).toBe(
      "not_met",
    );
  });

  it("GivenAnIncompleteStory_WhenMovedToReady_ThenRejectedWithGaps", async () => {
    const t = await service.create(projectId, { type: "story", title: "x", body: "y" }, "andy");
    await expect(service.move(projectId, t.id, "ready", "andy")).rejects.toMatchObject({
      code: "dor_not_met",
      details: expect.arrayContaining(["acceptance criteria", "tier"]),
    });
  });

  it("GivenFieldsThatCompleteTheDor_WhenUpdated_ThenDorMetAndMoveSucceeds", async () => {
    const t = await service.create(projectId, { type: "story", title: "x", body: "y" }, "andy");
    const updated = await service.update(projectId, t.id, readyStory, "andy");
    expect(updated.dorStatus).toBe("met");
    expect((await service.move(projectId, t.id, "ready", "andy")).stage).toBe("ready");
  });

  it("GivenASkip_WhenMovedWithoutForce_ThenInvalidTransition", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    await rejects(service.move(projectId, t.id, "done", "andy"), "invalid_transition");
  });

  it("GivenAForcedMove_WhenByAndyWithAReason_ThenRecordedInHistory", async () => {
    const t = await service.create(projectId, { type: "task", title: "x" }, "andy");
    const moved = await service.move(projectId, t.id, "done", "andy", {
      force: true,
      reason: "done outside the system",
    });
    expect(moved.stage).toBe("done");
    expect((await service.history(projectId, t.id)).at(-1)).toMatchObject({
      kind: "stage_changed",
      body: "done outside the system",
      data: { from: "backlog", to: "done", forced: true },
    });
  });

  it("GivenAForcedMove_WhenNotAndy_ThenForbidden", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    await rejects(
      service.move(projectId, t.id, "done", "agent:r1", { force: true, reason: "x" }),
      "forbidden",
    );
    await rejects(service.move(projectId, t.id, "done", "system", { force: true }), "forbidden");
  });

  it("GivenAForcedMove_WhenByAndyWithoutAReason_ThenRecordedAsForcedWithNoBody", async () => {
    const t = await service.create(projectId, { type: "task", title: "x" }, "andy");
    const moved = await service.move(projectId, t.id, "done", "andy", { force: true });
    expect(moved.stage).toBe("done");
    expect((await service.history(projectId, t.id)).at(-1)).toMatchObject({
      kind: "stage_changed",
      body: null,
      data: { from: "backlog", to: "done", forced: true },
    });
  });

  it("GivenAForcedMove_WhenTheReasonIsBlank_ThenStoredAsNoReason", async () => {
    const t = await service.create(projectId, { type: "task", title: "x" }, "andy");
    await service.move(projectId, t.id, "done", "andy", { force: true, reason: "  " });
    expect((await service.history(projectId, t.id)).at(-1)).toMatchObject({ body: null });
  });

  it("GivenAnOpenQuestion_WhenAsked_ThenTicketNeedsYouAndCantBeReady", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    const q = await service.ask(projectId, t.id, { text: "Which board?" }, "agent:r1");
    expect(await tracker.getTicket(projectId, t.id)).toMatchObject({
      needsYou: true,
      dorStatus: "not_met",
    });
    await rejects(service.move(projectId, t.id, "ready", "andy"), "dor_not_met");

    const inbox = await service.needsYou();
    expect(inbox.questions.map((x) => x.id)).toEqual([q.id]);
    expect(inbox.tickets.map((x) => x.id)).toEqual([t.id]);
  });

  it("GivenTheLastOpenQuestion_WhenAnswered_ThenNeedsYouClearsAndDorRechecked", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    const q = await service.ask(projectId, t.id, { text: "Which board?" }, "agent:r1");
    await service.answer(q.id, "Kanban", "ui", "andy");
    expect(await tracker.getTicket(projectId, t.id)).toMatchObject({
      needsYou: false,
      dorStatus: "met",
    });
    expect(await service.needsYou()).toEqual({ questions: [], tickets: [] });
  });

  it("GivenTwoOpenQuestionsAndTheDorOtherwiseMet_WhenBothAreAnswered_ThenTheLastAnswerMovesItToReady", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    const [q1, q2] = await tracker.askQuestions(
      projectId,
      t.id,
      [{ text: "Which board?" }, { text: "Which order?" }],
      "agent:r1",
      "r1",
    );
    await service.answer(q1!.id, "Kanban", "mcp", "andy");
    expect((await tracker.getTicket(projectId, t.id))?.stage).toBe("backlog");

    await service.answer(q2!.id, "By rank", "mcp", "andy");
    expect(await tracker.getTicket(projectId, t.id)).toMatchObject({
      stage: "ready",
      needsYou: false,
      dorStatus: "met",
    });
    expect((await tracker.listEvents(projectId, t.id)).at(-1)).toMatchObject({
      kind: "stage_changed",
      actor: "system",
      data: { from: "backlog", to: "ready", forced: false },
    });
  });

  it("GivenTheDorIsNotMetOtherwise_WhenTheLastQuestionIsAnswered_ThenItStaysInBacklog", async () => {
    const t = await service.create(projectId, { ...readyStory, tier: null }, "andy");
    const q = await service.ask(projectId, t.id, { text: "Which board?" }, "agent:r1");
    await service.answer(q.id, "Kanban", "mcp", "andy");
    expect(await tracker.getTicket(projectId, t.id)).toMatchObject({
      stage: "backlog",
      needsYou: false,
      dorStatus: "not_met",
    });
  });

  it("GivenAConcurrentEdit_WhenTheLastAnswerTriesToMoveIt_ThenTheAnswerStandsAndTheTicketStaysInBacklog", async () => {
    // A clock that ticks, so the concurrent edit changes updatedAt.
    let ms = Date.parse("2026-11-04T12:00:00.000Z");
    tracker = new InMemoryWorkTracker(() => new Date(ms++));
    service = new TicketService(tracker);
    projectId = (await tracker.createProject({ name: "AI2", key: "AJ" })).id;
    const t = await service.create(projectId, readyStory, "andy");
    const q = await service.ask(projectId, t.id, { text: "Which board?" }, "agent:r1");
    const original = tracker.updateTicket.bind(tracker);
    tracker.updateTicket = async (p, id, change, actor) => {
      // Someone edits the ticket between the move's read and its write.
      if (change.stage) await original(p, id, { fields: { title: "Board v2" } }, "andy");
      return original(p, id, change, actor);
    };
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(service.answer(q.id, "Kanban", "mcp", "andy")).resolves.toMatchObject({
      status: "answered",
    });
    expect(await tracker.getTicket(projectId, t.id)).toMatchObject({
      stage: "backlog",
      title: "Board v2",
    });
  });

  it("GivenATicketPastBacklog_WhenItsLastQuestionIsAnswered_ThenItsStageIsUnchanged", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    await service.move(projectId, t.id, "ready", "andy");
    await service.move(projectId, t.id, "in_progress", "andy");
    const q = await service.ask(projectId, t.id, { text: "Which board?" }, "agent:r1");
    await service.answer(q.id, "Kanban", "mcp", "andy");
    expect((await tracker.getTicket(projectId, t.id))?.stage).toBe("in_progress");
  });

  it("GivenATicketKey_WhenFound_ThenItIsReturnedAndUnknownOrMalformedKeysAreNotFound", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    expect((await service.findByKey(t.key)).id).toBe(t.id);
    for (const key of ["AI-999", "ZZ-1", "ai-1", "AI", "../x-1"]) {
      await expect(service.findByKey(key)).rejects.toMatchObject({ code: "not_found" });
    }
  });

  it("GivenATicketWithAnOpenQuestion_WhenStatusIsRead_ThenItShowsReadinessQuestionsAndRecentHistory", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    for (let i = 0; i < RECENT_EVENTS; i++) await service.comment(projectId, t.id, `c${i}`, "andy");
    const q = await service.ask(projectId, t.id, { text: "Which board?" }, "agent:r1");

    const status = await service.status(t.key);
    expect(status.ticket).toMatchObject({ key: t.key, needsYou: true });
    expect(status.readiness).toEqual({ met: false, missing: ["1 open question(s) answered"] });
    expect(status.questions.map((x) => x.id)).toEqual([q.id]);
    expect(status.recentEvents).toHaveLength(RECENT_EVENTS);
    expect(status.recentEvents.at(-1)?.kind).toBe("fields_changed");
  });

  it("GivenTicketsInSeveralStages_WhenTheOverviewIsRead_ThenCountsAreByProjectAndStage", async () => {
    await tracker.createProject({ name: "Other", key: "OT" });
    const t = await service.create(projectId, readyStory, "andy");
    await service.create(projectId, { type: "task", title: "x" }, "andy");
    await service.move(projectId, t.id, "ready", "andy");
    await service.ask(projectId, t.id, { text: "Which board?" }, "agent:r1");

    const overview = await service.overview();
    expect(overview.projects).toEqual([
      expect.objectContaining({
        key: "AI",
        ticketsByStage: expect.objectContaining({ backlog: 1, ready: 1, done: 0 }),
      }),
      expect.objectContaining({
        key: "OT",
        ticketsByStage: expect.objectContaining({ backlog: 0 }),
      }),
    ]);
    expect(overview.needsYou).toEqual({ questions: 1, tickets: 1 });
  });
  it("GivenAReadyTicket_WhenMovedForwardByKey_ThenOneStepAndNotForced", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    await service.move(projectId, t.id, "ready", "andy");
    const moved = await service.moveForward(t.key, "in_progress", "andy");
    expect(moved.stage).toBe("in_progress");
    expect((await tracker.listEvents(projectId, t.id)).at(-1)?.data).toMatchObject({
      forced: false,
    });
  });

  it("GivenABackwardOrSkippingMove_WhenMovedForwardByKey_ThenRejectedAndUnchanged", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    await service.move(projectId, t.id, "ready", "andy");
    await rejects(service.moveForward(t.key, "backlog", "andy"), "invalid_transition");
    await rejects(service.moveForward(t.key, "ready_for_review", "andy"), "invalid_transition");
    expect((await tracker.getTicket(projectId, t.id))?.stage).toBe("ready");
  });

  it("GivenAnIncompleteStory_WhenMovedForwardToReady_ThenTheDorStillApplies", async () => {
    const t = await service.create(projectId, { type: "story", title: "x" }, "andy");
    await rejects(service.moveForward(t.key, "ready", "andy"), "dor_not_met");
  });

  it("GivenAFlaggedTicket_WhenUnflagged_ThenClearedUnlessAQuestionIsOpen", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    await service.flag(projectId, t.id, "system");
    expect((await service.unflag(projectId, t.id, "system")).needsYou).toBe(false);
    await service.ask(projectId, t.id, { text: "Which?" }, "agent:r1");
    expect((await service.unflag(projectId, t.id, "system")).needsYou).toBe(true);
  });

  it("GivenATicket_WhenFlagged_ThenNeedsYou", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    expect((await service.flag(projectId, t.id, "system")).needsYou).toBe(true);
    expect((await service.needsYou()).tickets.map((x) => x.id)).toEqual([t.id]);
  });
});
