import { InMemoryWorkTracker, type Stage, type Ticket, type WorkTracker } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "./errors";
import {
  epicStage,
  epicStageFixes,
  epicStateOf,
  syncEpicStage,
  syncEpicStages,
} from "./epic-state";
import { TicketService } from "./tickets";

const at = (stage: Stage) => ({ stage });

describe("epicStage (ADR-0164)", () => {
  const open = { stage: "backlog" as Stage, needsCheck: false };

  it("GivenNoTickets_WhenComputed_ThenNotStarted", () => {
    expect(epicStage(open, [])).toBe("backlog");
    expect(epicStateOf(epicStage(open, []))).toBe("not_started");
  });

  it("GivenOnlyCancelledTickets_WhenComputed_ThenNotStarted", () => {
    expect(epicStage(open, [at("cancelled"), at("cancelled")])).toBe("backlog");
  });

  it("GivenTicketsAllInBacklog_WhenComputed_ThenNotStarted", () => {
    expect(epicStage(open, [at("backlog"), at("backlog")])).toBe("backlog");
  });

  it("GivenOneTicketPastBacklog_WhenComputed_ThenInProgress", () => {
    expect(epicStage(open, [at("backlog"), at("ready")])).toBe("in_progress");
    expect(epicStage(open, [at("done"), at("backlog")])).toBe("in_progress");
  });

  it("GivenEveryTicketDoneOrCancelled_WhenComputed_ThenDone", () => {
    expect(epicStage(open, [at("done"), at("cancelled"), at("done")])).toBe("done");
  });

  it("GivenNeedsCheckOn_WhenEveryTicketIsDone_ThenWaitingForTheCheck", () => {
    const flagged = { stage: "in_progress" as Stage, needsCheck: true };
    expect(epicStage(flagged, [at("done")])).toBe("ready_for_review");
    expect(epicStateOf("ready_for_review")).toBe("waiting_for_check");
  });

  it("GivenNeedsCheckOnAndTheOwnerClosedIt_WhenComputed_ThenItStaysDone", () => {
    expect(epicStage({ stage: "done", needsCheck: true }, [at("done")])).toBe("done");
  });

  it("GivenNeedsCheckOff_WhenEveryTicketIsDone_ThenDoneByDefault", () => {
    expect(epicStage({ stage: "in_progress", needsCheck: false }, [at("done")])).toBe("done");
  });
});

describe("syncEpicStages (ADR-0164)", () => {
  let raw: InMemoryWorkTracker;
  let tracker: WorkTracker;
  let service: TicketService;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    raw = new InMemoryWorkTracker();
    await raw.createProject({ key: "AI", name: "AI", repos: ["o/r"], autonomy: "gated" });
    tracker = syncEpicStages(raw);
    service = new TicketService(tracker);
  });

  const newEpic = (title = "Epic", parentId: string | null = null, needsCheck = false) =>
    service.create("ai", { type: "epic", title, parentId, needsCheck }, "andy");
  const newTicket = (parentId: string, title = "Ticket") =>
    service.create("ai", { type: "feature", title, parentId }, "andy");
  const moveTo = (t: Ticket, to: Stage) =>
    tracker.updateTicket("ai", t.id, { stage: { to, forced: false, reason: null } }, "system");
  const get = async (t: Ticket) => (await raw.getTicket("ai", t.id))!;

  it("GivenAnEpicWithNoTickets_WhenRead_ThenItIsNotStarted", async () => {
    const epic = await newEpic();
    expect((await get(epic)).stage).toBe("backlog");
  });

  it("GivenAnEpicInReady_WhenItsFirstTicketIsAdded_ThenItIsPutBackInStepAtOnce", async () => {
    const epic = await newEpic();
    await raw.updateTicket(
      "ai",
      epic.id,
      { stage: { to: "ready", forced: true, reason: null } },
      "andy",
    );
    await newTicket(epic.id);
    expect((await get(epic)).stage).toBe("backlog");
  });

  it("GivenAnEpicsTicketStarts_WhenItMoves_ThenTheEpicIsInProgress", async () => {
    const epic = await newEpic();
    const child = await newTicket(epic.id);
    await moveTo(child, "ready");
    expect((await get(epic)).stage).toBe("in_progress");
  });

  it("GivenTheLastOpenTicket_WhenItReachesDone_ThenTheEpicIsDoneWithAHistoryEntry", async () => {
    const epic = await newEpic();
    const a = await newTicket(epic.id, "A");
    const b = await newTicket(epic.id, "B");
    const c = await newTicket(epic.id, "C");
    await moveTo(a, "done");
    await service.cancel("ai", b.id, "andy");
    expect((await get(epic)).stage).toBe("in_progress");
    await moveTo(c, "done");
    expect((await get(epic)).stage).toBe("done");
    const moves = (await raw.listEvents("ai", epic.id)).filter((e) => e.kind === "stage_changed");
    expect(moves.at(-1)).toMatchObject({
      actor: "system",
      body: "follows its tickets: 2 of 2 done",
      data: { from: "in_progress", to: "done", forced: false },
    });
  });

  it("GivenADoneEpic_WhenATicketIsAdded_ThenItIsInProgressAgain", async () => {
    const epic = await newEpic();
    const a = await newTicket(epic.id);
    await moveTo(a, "done");
    await moveTo(await newTicket(epic.id, "Late"), "ready");
    expect((await get(epic)).stage).toBe("in_progress");
  });

  it("GivenADoneEpic_WhenACancelledTicketIsReopened_ThenItLeavesDone", async () => {
    const epic = await newEpic();
    const a = await newTicket(epic.id, "A");
    const b = await newTicket(epic.id, "B");
    await service.cancel("ai", b.id, "andy");
    await moveTo(a, "done");
    expect((await get(epic)).stage).toBe("done");
    await service.move("ai", b.id, "backlog", "andy");
    expect((await get(epic)).stage).toBe("in_progress");
  });

  it("GivenADoneArchivedEpic_WhenItReopens_ThenItIsUnarchived", async () => {
    const epic = await newEpic();
    const a = await newTicket(epic.id);
    await moveTo(a, "done");
    await service.archive("ai", epic.id, true, "andy");
    await moveTo(await newTicket(epic.id, "Late"), "in_progress");
    expect(await get(epic)).toMatchObject({ stage: "in_progress", archived: false });
  });

  it("GivenTheLastOpenTicket_WhenItIsMovedToAnotherEpic_ThenBothEpicsFollow", async () => {
    const one = await newEpic("One");
    const two = await newEpic("Two");
    const done = await newTicket(one.id, "Done");
    const open = await newTicket(one.id, "Open");
    await moveTo(done, "done");
    await moveTo(open, "in_progress");
    await service.reparentByKey(open.key, two.key, "andy");
    expect((await get(one)).stage).toBe("done");
    expect((await get(two)).stage).toBe("in_progress");
  });

  it("GivenANestedEpic_WhenItsLastTicketIsDone_ThenTheChildAndTheParentAreDone", async () => {
    const parent = await newEpic("Parent");
    const child = await newEpic("Child", parent.id);
    const direct = await newTicket(parent.id, "Direct");
    const deep = await newTicket(child.id, "Deep");
    await moveTo(direct, "done");
    await moveTo(deep, "in_progress");
    expect((await get(child)).stage).toBe("in_progress");
    expect((await get(parent)).stage).toBe("in_progress");
    await moveTo(deep, "done");
    expect((await get(child)).stage).toBe("done");
    expect((await get(parent)).stage).toBe("done");
  });

  it("GivenAnEmptyChildEpic_WhenTheParentsOtherTicketsAreDone_ThenTheParentIsInProgress", async () => {
    const parent = await newEpic("Parent");
    await newEpic("Empty child", parent.id);
    await moveTo(await newTicket(parent.id), "done");
    expect((await get(parent)).stage).toBe("in_progress");
  });

  it("GivenNeedsCheckOn_WhenTheLastTicketIsDone_ThenTheEpicWaitsAndOnlyTheOwnerClosesIt", async () => {
    const epic = await newEpic("Checked", null, true);
    await moveTo(await newTicket(epic.id), "done");
    expect((await get(epic)).stage).toBe("ready_for_review");
    await expect(service.moveForward(epic.key, "done", "agent:run-1")).rejects.toMatchObject({
      code: "forbidden",
    });
    const closed = await service.moveForward(epic.key, "done", "user:owner");
    expect(closed.stage).toBe("done");
    expect((await get(epic)).stage).toBe("done");
  });

  it("GivenAClosedCheckedEpic_WhenATicketIsAdded_ThenItReopensAndWaitsAgainLater", async () => {
    const epic = await newEpic("Checked", null, true);
    await moveTo(await newTicket(epic.id), "done");
    await service.moveForward(epic.key, "done", "andy");
    const late = await newTicket(epic.id, "Late");
    await moveTo(late, "ready");
    expect((await get(epic)).stage).toBe("in_progress");
    await moveTo(late, "done");
    expect((await get(epic)).stage).toBe("ready_for_review");
  });

  it("GivenAWaitingEpic_WhenTheCheckIsTurnedOff_ThenItClosesItself", async () => {
    const epic = await newEpic("Checked", null, true);
    await moveTo(await newTicket(epic.id), "done");
    await service.update("ai", epic.id, { needsCheck: false }, "andy");
    expect((await get(epic)).stage).toBe("done");
  });

  it("GivenACancelledEpic_WhenItsTicketsChange_ThenItStaysCancelled", async () => {
    const epic = await newEpic();
    const child = await newTicket(epic.id);
    await service.cancel("ai", epic.id, "andy");
    await moveTo(child, "done");
    expect((await get(epic)).stage).toBe("cancelled");
  });

  it("GivenACancelledEpicWithADoneTicket_WhenReopened_ThenItTakesItsComputedStage", async () => {
    const epic = await newEpic();
    const child = await newTicket(epic.id);
    await service.cancel("ai", epic.id, "andy");
    await moveTo(child, "done");
    const reopened = await service.move("ai", epic.id, "backlog", "andy");
    expect(reopened.stage).toBe("done");
  });

  it("GivenAnEpicReadFails_WhenATicketMoves_ThenTheMoveStandsAndTheFailureIsLogged", async () => {
    const epic = await newEpic();
    const child = await newTicket(epic.id);
    const log = vi.spyOn(console, "log");
    vi.spyOn(raw, "listTickets").mockRejectedValueOnce(new Error("store down"));
    const moved = await moveTo(child, "ready");
    expect(moved.stage).toBe("ready");
    expect(log.mock.calls.some(([line]) => String(line).includes("epic stage sync failed"))).toBe(
      true,
    );
  });

  it("GivenAWriteThatChangesNoStageOrParent_WhenMade_ThenNoEpicIsRead", async () => {
    const epic = await newEpic();
    const child = await newTicket(epic.id);
    const reads = vi.spyOn(raw, "listTickets");
    await tracker.updateTicket("ai", child.id, { fields: { title: "Renamed" } }, "andy");
    expect(reads).not.toHaveBeenCalled();
  });
});

describe("epic moves are refused (ADR-0164)", () => {
  let service: TicketService;
  let epic: Ticket;

  beforeEach(async () => {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ key: "AI", name: "AI", repos: ["o/r"], autonomy: "gated" });
    service = new TicketService(syncEpicStages(tracker));
    epic = await service.create("ai", { type: "epic", title: "Epic" }, "andy");
  });

  it("GivenAnEpic_WhenAnyoneMovesIt_ThenItIsRefusedWithTheReason", async () => {
    const refusal = service.move("ai", epic.id, "ready", "andy");
    await expect(refusal).rejects.toBeInstanceOf(DomainError);
    await expect(service.move("ai", epic.id, "ready", "andy")).rejects.toThrow(
      "AI-1 is an epic: its state follows its tickets, so it can't be moved",
    );
  });

  it("GivenAnEpic_WhenTheOwnerForcesAMove_ThenItIsRefusedToo", async () => {
    await expect(
      service.move("ai", epic.id, "done", "andy", { force: true, reason: "done" }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("GivenAnEpic_WhenMoveTicketStepsItForward_ThenItIsRefused", async () => {
    await expect(service.moveForward(epic.key, "ready", "user:owner")).rejects.toThrow(
      "its state follows its tickets",
    );
  });
});

describe("syncEpicStage and epicStageFixes (the fix-up)", () => {
  const t = (id: string, over: Partial<Ticket>): Ticket =>
    ({
      id,
      key: `AI-${id}`,
      title: id,
      type: "feature",
      parentId: null,
      stage: "backlog",
      needsCheck: false,
      archived: false,
      ...over,
    }) as Ticket;

  it("GivenStaleEpics_WhenPlanned_ThenChildEpicsComeBeforeTheirParentsAndCancelledAreLeft", () => {
    const tickets = [
      t("1", { type: "epic", stage: "ready" }),
      t("2", { type: "epic", parentId: "1" }),
      t("3", { parentId: "2", stage: "done" }),
      t("4", { type: "epic", stage: "cancelled" }),
      t("5", { parentId: "4", stage: "done" }),
      t("6", { type: "epic", stage: "done" }),
      t("7", { parentId: "6", stage: "done", archived: true }),
    ];
    expect(epicStageFixes(tickets).map((f) => [f.key, f.from, f.to])).toEqual([
      ["AI-2", "backlog", "done"],
      ["AI-1", "ready", "done"],
    ]);
  });

  it("GivenEpicsInStep_WhenPlanned_ThenNothingToDo", () => {
    expect(
      epicStageFixes([
        t("1", { type: "epic", stage: "done" }),
        t("2", { parentId: "1", stage: "done" }),
      ]),
    ).toEqual([]);
  });

  it("GivenAStaleEpic_WhenSyncedTwice_ThenTheSecondWritesNothing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ key: "AI", name: "AI", repos: ["o/r"], autonomy: "gated" });
    const epic = await tracker.createTicket("ai", { type: "epic", title: "E" }, "andy");
    const child = await tracker.createTicket("ai", { title: "C", parentId: epic.id }, "andy");
    await tracker.updateTicket(
      "ai",
      child.id,
      { stage: { to: "done", forced: true, reason: null } },
      "andy",
    );
    expect((await syncEpicStage(tracker, "ai", epic.id))?.stage).toBe("done");
    expect(await syncEpicStage(tracker, "ai", epic.id)).toBeNull();
  });
});
