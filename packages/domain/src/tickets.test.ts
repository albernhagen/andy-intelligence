import { InMemoryWorkTracker, type NewTicket } from "@andy/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { DomainError, TicketService } from "./tickets";

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
});
