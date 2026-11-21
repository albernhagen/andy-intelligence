import type { Milestone, Ticket } from "@andy/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  epicChainOf,
  milestoneHoldReason,
  MilestoneHolds,
  ticketMilestoneHold,
} from "./milestone-holds";

/** AI-306: M4.36: dispatch starts a ticket only when its milestone is approved or it has none. */

const AT = "2026-11-21T12:00:00.000Z";

const t = (over: Partial<Ticket> & { id: string }): Ticket =>
  ({
    projectId: "ai",
    key: `AI-${over.id}`,
    type: "feature",
    parentId: null,
    milestoneId: null,
    stage: "ready",
    ...over,
  }) as Ticket;

const milestone = (id: string, status: Milestone["status"]): Milestone => ({
  id,
  projectId: "ai",
  name: `M${id}: Things`,
  outcome: "Things work.",
  order: 1,
  status,
  createdAt: AT,
  updatedAt: AT,
});

const storeOf = (...ms: Milestone[]) => ({
  get: vi.fn(async (_p: string, id: string) => ms.find((m) => m.id === id) ?? null),
});

const epic = t({ id: "1", type: "epic", milestoneId: "5" });
const child = t({ id: "2", parentId: "1" });

describe("milestone holds (AI-306)", () => {
  it("GivenEachStatus_WhenAReasonIsAsked_ThenOnlyApprovedHasNone", () => {
    expect(milestoneHoldReason("5", milestone("5", "approved"))).toBeNull();
    expect(milestoneHoldReason("5", milestone("5", "parked"))).toBe(
      "Milestone M5: Things is parked",
    );
    expect(milestoneHoldReason("5", milestone("5", "not_reviewed"))).toBe(
      "Milestone M5: Things is not reviewed",
    );
    expect(milestoneHoldReason("5", null)).toBe("Milestone 5 can't be read");
  });

  it("GivenATicketWithNoMilestone_WhenHoldsAreChecked_ThenItRunsAndNothingIsRead", async () => {
    const store = storeOf();
    const plain = t({ id: "9" });
    const epicWithout = t({ id: "8", type: "epic" });
    const holds = new MilestoneHolds(store, "ai");
    expect(await holds.reasonFor(plain, [])).toBeNull();
    expect(await holds.reasonFor(t({ id: "7", parentId: "8" }), [epicWithout])).toBeNull();
    expect(store.get).not.toHaveBeenCalled();
  });

  it("GivenAParkedMilestone_WhenItsTicketsAreChecked_ThenEachIsHeldWithOneRead", async () => {
    const store = storeOf(milestone("5", "parked"));
    const holds = new MilestoneHolds(store, "ai");
    const other = t({ id: "3", parentId: "1" });
    expect(await holds.reasonFor(child, [epic])).toBe("Milestone M5: Things is parked");
    expect(await holds.reasonFor(other, [epic])).toBe("Milestone M5: Things is parked");
    expect(await holds.reasonFor(epic, [])).toBe("Milestone M5: Things is parked");
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("GivenAChildEpic_WhenItsStoryIsChecked_ThenTheTopLevelEpicsMilestoneCounts", async () => {
    const holds = new MilestoneHolds(storeOf(milestone("5", "parked")), "ai");
    const childEpic = t({ id: "4", type: "epic", parentId: "1" });
    const story = t({ id: "6", parentId: "4" });
    expect(await holds.reasonFor(story, [epic, childEpic])).toBe("Milestone M5: Things is parked");
  });

  it("GivenAnApprovedMilestone_WhenItsTicketIsChecked_ThenItRuns", async () => {
    const holds = new MilestoneHolds(storeOf(milestone("5", "approved")), "ai");
    expect(await holds.reasonFor(child, [epic])).toBeNull();
  });

  it("GivenAMilestoneThatCantBeRead_WhenItsTicketIsChecked_ThenItIsHeld", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const failing = { get: vi.fn(() => Promise.reject(new Error("unavailable"))) };
    expect(await new MilestoneHolds(failing, "ai").reasonFor(child, [epic])).toBe(
      "Milestone 5 can't be read",
    );
    expect(await new MilestoneHolds(storeOf(), "ai").reasonFor(child, [epic])).toBe(
      "Milestone 5 can't be read",
    );
    expect(await new MilestoneHolds(null, "ai").reasonFor(child, [epic])).toBe(
      "Milestone 5 can't be read",
    );
  });

  it("GivenAnEpicChainNotLoaded_WhenTheTicketIsChecked_ThenItIsHeld", async () => {
    const store = storeOf(milestone("5", "approved"));
    expect(await new MilestoneHolds(store, "ai").reasonFor(child, [])).toBe(
      "Milestone can't be read: its epic wasn't found",
    );
  });
});

describe("epic chain reads (AI-306)", () => {
  const childEpic = t({ id: "4", type: "epic", parentId: "1" });
  const story = t({ id: "6", parentId: "4" });
  const tracker = () => ({
    getTicket: vi.fn(
      async (_p: string, id: string) => [epic, childEpic].find((x) => x.id === id) ?? null,
    ),
  });

  it("GivenAStoryUnderAChildEpic_WhenItsChainIsRead_ThenTwoTicketsAreReadAtMost", async () => {
    const tr = tracker();
    expect((await epicChainOf(tr, story)).map((x) => x.id)).toEqual(["4", "1"]);
    expect(tr.getTicket).toHaveBeenCalledTimes(2);
  });

  it("GivenTheEpicsAreKnown_WhenTheChainIsRead_ThenNothingIsRead", async () => {
    const tr = tracker();
    expect(await epicChainOf(tr, story, [epic, childEpic])).toEqual([]);
    expect(await epicChainOf(tr, t({ id: "10" }))).toEqual([]);
    expect(tr.getTicket).not.toHaveBeenCalled();
  });

  it("GivenAHeldTicketInDone_WhenItsStatusHoldIsAsked_ThenNoneIsShownAndNothingIsRead", async () => {
    const tr = tracker();
    const store = storeOf(milestone("5", "parked"));
    expect(await ticketMilestoneHold(tr, store, { ...child, stage: "done" })).toBeNull();
    expect(tr.getTicket).not.toHaveBeenCalled();
    expect(await ticketMilestoneHold(tr, store, child)).toBe("Milestone M5: Things is parked");
    expect(await ticketMilestoneHold(tr, store, { ...child, stage: "backlog" })).toBe(
      "Milestone M5: Things is parked",
    );
  });
});
