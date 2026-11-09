import type { Ticket } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { IDEAS_ZONE, UP_NEXT_ZONE, planUpNextDrop, splitBacklog } from "./board";

const ticket = (id: string, upNextRank: string | null, stage: Ticket["stage"] = "backlog") =>
  ({ id, stage, rank: "0000000001", upNextRank }) as Ticket;
const a = ticket("a", "0000000001");
const b = ticket("b", "0000000002");
const idea = ticket("i", null);
const backlog = [idea, b, a];

describe("Backlog parts", () => {
  it("GivenABacklog_WhenSplit_ThenUpNextIsInItsOrderAndIdeasFollow", () => {
    expect(splitBacklog(backlog).upNext.map((t) => t.id)).toEqual(["a", "b"]);
    expect(splitBacklog(backlog).ideas.map((t) => t.id)).toEqual(["i"]);
  });

  it("GivenAnIdea_WhenDroppedOnTheUpNextHeader_ThenItJoinsTheEnd", () => {
    expect(planUpNextDrop(backlog, idea, UP_NEXT_ZONE)!.rank! > b.upNextRank!).toBe(true);
  });

  it("GivenAnIdea_WhenDroppedOnAnUpNextCard_ThenItGoesAboveIt", () => {
    const plan = planUpNextDrop(backlog, idea, "b");
    expect(plan?.upNext).toBe(true);
    expect(plan!.rank! > a.upNextRank! && plan!.rank! < b.upNextRank!).toBe(true);
  });

  it("GivenAnUpNextCard_WhenDroppedOnTheHeader_ThenItGoesToTheTop", () => {
    expect(planUpNextDrop(backlog, b, UP_NEXT_ZONE)!.rank! < a.upNextRank!).toBe(true);
  });

  it("GivenAnUpNextCard_WhenDroppedOnIdeas_ThenItLeavesUpNext", () => {
    expect(planUpNextDrop(backlog, a, IDEAS_ZONE)).toEqual({ upNext: false, rank: null });
    expect(planUpNextDrop(backlog, a, "i")).toEqual({ upNext: false, rank: null });
  });

  it("GivenAnIdea_WhenDroppedAmongIdeas_ThenUpNextIsNotInvolved", () => {
    expect(planUpNextDrop(backlog, idea, IDEAS_ZONE)).toBeNull();
  });

  it("GivenACardOnItself_WhenDropped_ThenNothing", () => {
    expect(planUpNextDrop(backlog, a, "a")).toBeNull();
  });
});
