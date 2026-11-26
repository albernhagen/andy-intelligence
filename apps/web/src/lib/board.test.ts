import type { Ticket } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { IDEAS_ZONE, UP_NEXT_ZONE, openingStage, planUpNextDrop, splitBacklog } from "./board";

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

  it("GivenACardFromALaterStage_WhenDroppedOnTheUpNextHeader_ThenItLandsInIdeas", () => {
    const back = ticket("w", null, "in_progress");
    expect(planUpNextDrop(backlog, back, UP_NEXT_ZONE)).toEqual({ upNext: false, rank: null });
  });

  it("GivenACardFromALaterStage_WhenDroppedOnAnUpNextCard_ThenItLandsInIdeas", () => {
    const back = ticket("w", null, "ready");
    expect(planUpNextDrop(backlog, back, "b")).toEqual({ upNext: false, rank: null });
  });

  it("GivenACardFromALaterStage_WhenDroppedOnIdeas_ThenUpNextIsNotInvolved", () => {
    const back = ticket("w", null, "in_progress");
    expect(planUpNextDrop(backlog, back, IDEAS_ZONE)).toBeNull();
    expect(planUpNextDrop(backlog, back, "i")).toBeNull();
  });

  it("GivenACardOnItself_WhenDropped_ThenNothing", () => {
    expect(planUpNextDrop(backlog, a, "a")).toBeNull();
  });
});

describe("Phone board's opening stage", () => {
  const stages = ["backlog", "ready", "in_progress", "ready_for_review", "done"] as const;
  const t = (stage: Ticket["stage"], needs: boolean) => ({ stage, needs });

  it("GivenTicketsThatNeedYouInTwoStages_WhenOpened_ThenTheFirstStageInBoardOrderShows", () => {
    const tickets = [t("ready_for_review", true), t("ready", true), t("backlog", false)];
    expect(openingStage(stages, tickets, (x) => x.needs)).toBe("ready");
  });

  it("GivenNothingNeedsYou_WhenOpened_ThenInProgressShows", () => {
    expect(openingStage(stages, [t("backlog", false)], (x) => x.needs)).toBe("in_progress");
  });

  it("GivenANeedsYouTicketInAHiddenStage_WhenOpened_ThenItIsSkipped", () => {
    expect(openingStage(stages, [t("cancelled", true)], (x) => x.needs)).toBe("in_progress");
  });
});
