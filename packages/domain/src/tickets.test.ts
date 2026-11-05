import { InMemoryWorkTracker, type NewTicket, type Run } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError, RECENT_EVENTS, TicketService, type RunCanceller } from "./tickets";

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

  it("GivenAForcedMove_WhenNotAndyOrNoReason_ThenRejected", async () => {
    const t = await service.create(projectId, readyStory, "andy");
    await rejects(
      service.move(projectId, t.id, "done", "agent:r1", { force: true, reason: "x" }),
      "forbidden",
    );
    await rejects(
      service.move(projectId, t.id, "done", "andy", { force: true, reason: " " }),
      "reason_required",
    );
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

  describe("cancel and archive", () => {
    let canceller: { cancelForTicket: ReturnType<typeof vi.fn<RunCanceller["cancelForTicket"]>> };

    beforeEach(() => {
      canceller = { cancelForTicket: vi.fn<RunCanceller["cancelForTicket"]>(async () => []) };
      service = new TicketService(tracker, canceller);
    });

    const cancelled = async () => {
      const t = await service.create(projectId, readyStory, "andy");
      return service.cancel(projectId, t.id, "andy");
    };

    it("GivenATicketInAnyStage_WhenAndyCancelsItWithAReason_ThenItIsCancelledAndHistoryRecordsWhoAndWhy", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      await service.move(projectId, t.id, "ready", "andy");
      const result = await service.cancel(projectId, t.id, "andy", " not needed ");
      expect(result.stage).toBe("cancelled");
      expect((await service.history(projectId, t.id)).at(-1)).toMatchObject({
        kind: "stage_changed",
        actor: "andy",
        body: "not needed",
        data: { from: "ready", to: "cancelled", forced: false },
      });
    });

    it("GivenNoReason_WhenAndyCancels_ThenTheStageEventHasNoBody", async () => {
      const t = await cancelled();
      expect((await service.history(projectId, t.id)).at(-1)).toMatchObject({ body: null });
    });

    it("GivenARunInFlight_WhenTheTicketIsCancelled_ThenTheRunIsCancelledFirstAndCommented", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      canceller.cancelForTicket.mockImplementation(async () => {
        // The ticket is unchanged while the run is being stopped.
        expect((await tracker.getTicket(projectId, t.id))?.stage).toBe("backlog");
        return [{ id: "r1", step: "refine", links: {} } as Run];
      });
      await service.cancel(projectId, t.id, "andy");
      expect(canceller.cancelForTicket).toHaveBeenCalledWith(projectId, t.id);
      const events = await service.history(projectId, t.id);
      expect(events.at(-1)).toMatchObject({ kind: "comment", actor: "system" });
      expect(events.at(-1)?.body).toContain("r1");
    });

    it("GivenTheTicketChangesWhileItsRunsStop_WhenCancelled_ThenItIsStillCancelled", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      canceller.cancelForTicket.mockImplementation(async () => {
        await tracker.updateTicket(projectId, t.id, { fields: { needsYou: true } }, "system");
        return [];
      });
      expect((await service.cancel(projectId, t.id, "andy")).stage).toBe("cancelled");
    });

    it("GivenOpenQuestions_WhenTheTicketIsCancelled_ThenTheyAreWithdrawnAndItLeavesTheInbox", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      const q1 = await service.ask(projectId, t.id, { text: "Which?" }, "agent:r1");
      const q2 = await service.ask(projectId, t.id, { text: "Why?" }, "agent:r1");
      await service.answer(q2.id, "because", "ui", "andy");
      await service.ask(projectId, t.id, { text: "When?" }, "agent:r1");

      const result = await service.cancel(projectId, t.id, "andy");
      expect(result).toMatchObject({ stage: "cancelled", needsYou: false });
      const statuses = (await tracker.listQuestions({ ticketId: t.id })).map((q) => q.status);
      expect(statuses).toEqual(["withdrawn", "answered", "withdrawn"]);
      expect(await tracker.getQuestion(q1.id)).toMatchObject({ status: "withdrawn" });
      expect(await service.needsYou()).toEqual({ questions: [], tickets: [] });
      const kinds = (await service.history(projectId, t.id)).map((e) => e.kind);
      expect(kinds.filter((k) => k === "question_withdrawn")).toHaveLength(2);
    });

    it("GivenWithdrawnQuestions_WhenTheTicketIsReopened_ThenTheyStayWithdrawn", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      await service.ask(projectId, t.id, { text: "Which?" }, "agent:r1");
      await service.cancel(projectId, t.id, "andy");

      const reopened = await service.move(projectId, t.id, "backlog", "andy");
      expect(reopened.needsYou).toBe(false);
      expect(await tracker.listQuestions({ ticketId: t.id, status: "open" })).toEqual([]);
      expect(await service.needsYou()).toEqual({ questions: [], tickets: [] });
    });

    it("GivenAQuestionAskedDuringTheCancel_WhenTheTicketIsReopened_ThenItIsWithdrawnAndNeedsYouIsClear", async () => {
      const t = await cancelled();
      // A question that landed between cancel's stage check and its withdraw step.
      const late = await tracker.askQuestion(projectId, t.id, { text: "Late?" }, "agent:r1");
      await tracker.updateTicket(projectId, t.id, { fields: { needsYou: true } }, "system");

      const reopened = await service.move(projectId, t.id, "backlog", "andy");
      expect(reopened).toMatchObject({ stage: "backlog", needsYou: false });
      expect(await tracker.getQuestion(late.id)).toMatchObject({ status: "withdrawn" });
      expect(await service.needsYou()).toEqual({ questions: [], tickets: [] });
    });

    it("GivenAQuestionAnsweredWhileCancelling_WhenTheTicketIsCancelled_ThenItStaysAnswered", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      const q = await service.ask(projectId, t.id, { text: "Which?" }, "agent:r1");
      canceller.cancelForTicket.mockImplementation(async () => {
        await tracker.answerQuestion(q.id, "a", "mcp", "andy");
        return [];
      });
      const listed = vi
        .spyOn(tracker, "listQuestions")
        .mockResolvedValueOnce([{ ...q, status: "open" }]);
      expect((await service.cancel(projectId, t.id, "andy")).stage).toBe("cancelled");
      expect(await tracker.getQuestion(q.id)).toMatchObject({ status: "answered" });
      listed.mockRestore();
    });

    it("GivenACancelledTicket_WhenAQuestionIsAsked_ThenInvalidTransitionAndItStaysOutOfTheInbox", async () => {
      const t = await cancelled();
      await rejects(
        service.ask(projectId, t.id, { text: "Late?" }, "agent:r1"),
        "invalid_transition",
      );
      expect(await tracker.listQuestions({ ticketId: t.id })).toEqual([]);
      expect((await tracker.getTicket(projectId, t.id))?.needsYou).toBe(false);
    });

    it("GivenWithdrawingFailsPartway_WhenTheTicketIsCancelled_ThenItIsCancelledAndOutOfTheInbox", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      await service.ask(projectId, t.id, { text: "Which?" }, "agent:r1");
      vi.spyOn(tracker, "withdrawQuestion").mockRejectedValueOnce(new Error("store down"));
      await expect(service.cancel(projectId, t.id, "andy")).rejects.toThrow("store down");
      expect(await tracker.getTicket(projectId, t.id)).toMatchObject({
        stage: "cancelled",
        needsYou: false,
      });
      expect(await service.needsYou()).toEqual({ questions: [], tickets: [] });
    });

    it("GivenTheRunCantBeStopped_WhenTheTicketIsCancelled_ThenTheStageIsUnchanged", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      canceller.cancelForTicket.mockRejectedValue(new DomainError("cancel_failed", "no"));
      const q = await service.ask(projectId, t.id, { text: "Which?" }, "agent:r1");
      await rejects(service.cancel(projectId, t.id, "andy"), "cancel_failed");
      expect((await tracker.getTicket(projectId, t.id))?.stage).toBe("backlog");
      expect(await tracker.getQuestion(q.id)).toMatchObject({ status: "open" });
    });

    it("GivenAnAgentOrTheSystem_WhenCancellingOrArchiving_ThenForbidden", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      await rejects(service.cancel(projectId, t.id, "agent:r1"), "forbidden");
      await rejects(service.cancel(projectId, t.id, "system"), "forbidden");
      const c = await service.cancel(projectId, t.id, "andy");
      await rejects(service.archive(projectId, c.id, true, "agent:r1"), "forbidden");
      await rejects(service.archive(projectId, c.id, true, "system"), "forbidden");
      expect(canceller.cancelForTicket).toHaveBeenCalledTimes(1);
    });

    it("GivenACancelledTicket_WhenCancelledAgain_ThenInvalidTransition", async () => {
      const t = await cancelled();
      await rejects(service.cancel(projectId, t.id, "andy"), "invalid_transition");
    });

    it("GivenAnyTicket_WhenMovedOrForcedToCancelled_ThenInvalidTransition", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      await rejects(service.move(projectId, t.id, "cancelled", "andy"), "invalid_transition");
      await rejects(
        service.move(projectId, t.id, "cancelled", "andy", { force: true, reason: "x" }),
        "invalid_transition",
      );
    });

    it("GivenACancelledTicket_WhenAndyReopensIt_ThenItIsInBacklog", async () => {
      const t = await cancelled();
      expect((await service.move(projectId, t.id, "backlog", "andy")).stage).toBe("backlog");
    });

    it("GivenACancelledTicket_WhenAnAgentReopensIt_ThenForbidden", async () => {
      const t = await cancelled();
      await rejects(service.move(projectId, t.id, "backlog", "agent:r1"), "forbidden");
      await rejects(service.move(projectId, t.id, "backlog", "system"), "forbidden");
    });

    it("GivenACancelledTicket_WhenMovedPastBacklog_ThenInvalidTransition", async () => {
      const t = await cancelled();
      await rejects(service.move(projectId, t.id, "ready", "andy"), "invalid_transition");
    });

    it("GivenADoneOrCancelledTicket_WhenAndyArchivesIt_ThenItIsArchivedAndHistoryRecordsIt", async () => {
      const c = await cancelled();
      const d = await service.create(projectId, readyStory, "andy");
      await service.move(projectId, d.id, "done", "andy", { force: true, reason: "shipped" });
      expect((await service.archive(projectId, c.id, true, "andy")).archived).toBe(true);
      expect((await service.archive(projectId, d.id, true, "andy")).archived).toBe(true);
      expect((await service.history(projectId, c.id)).at(-1)).toMatchObject({
        kind: "fields_changed",
        actor: "andy",
        data: { diff: { archived: { from: false, to: true } } },
      });
    });

    it("GivenATicketNotDoneOrCancelled_WhenArchived_ThenInvalidTransition", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      await rejects(service.archive(projectId, t.id, true, "andy"), "invalid_transition");
    });

    it("GivenAnArchivedTicket_WhenUnarchived_ThenItIsVisibleAgain", async () => {
      const t = await cancelled();
      await service.archive(projectId, t.id, true, "andy");
      expect((await service.archive(projectId, t.id, false, "andy")).archived).toBe(false);
    });

    it("GivenAnArchivedCancelledTicket_WhenReopened_ThenItIsUnarchivedInBacklog", async () => {
      const t = await cancelled();
      await service.archive(projectId, t.id, true, "andy");
      const reopened = await service.move(projectId, t.id, "backlog", "andy");
      expect(reopened).toMatchObject({ stage: "backlog", archived: false });
    });

    it("GivenAnArchivedTicketWithAnOpenQuestion_WhenTheInboxAndOverviewAreRead_ThenItIsHidden", async () => {
      const t = await service.create(projectId, readyStory, "andy");
      await service.move(projectId, t.id, "done", "andy", { force: true, reason: "shipped" });
      await service.ask(projectId, t.id, { text: "Still needed?" }, "agent:r1");
      await service.create(projectId, { type: "task", title: "visible" }, "andy");
      expect((await service.overview()).projects[0]?.ticketsByStage.done).toBe(1);
      expect((await service.needsYou()).tickets).toHaveLength(1);

      await service.archive(projectId, t.id, true, "andy");
      const inbox = await service.needsYou();
      expect(inbox).toEqual({ questions: [], tickets: [] });
      const overview = await service.overview();
      expect(overview.projects[0]?.ticketsByStage).toMatchObject({ backlog: 1, done: 0 });
      expect(overview.needsYou).toEqual({ questions: 0, tickets: 0 });
    });
  });
});
