import { describe, expect, it } from "vitest";
import type { Ticket } from "@andy/contracts";
import { blockerProblem, parentProblem, reorderRank } from "./ticket-edits";

const t = (key: string, fields: Partial<Ticket> = {}) =>
  ({
    id: key,
    key,
    type: "chore",
    stage: "ready",
    rank: `000000000${key.slice(-1)}`,
    upNextRank: null,
    archived: false,
    parentId: null,
    blockedBy: [],
    ...fields,
  }) as Ticket;

describe("reorderRank", () => {
  const lane = [t("AI-1"), t("AI-2"), t("AI-3")];

  it("GivenATicket_WhenPlacedAboveAnother_ThenItsRankSortsBetweenItsNewNeighbours", () => {
    const placed = reorderRank(lane[2]!, { above: "AI-2" }, lane);
    expect(placed).toMatchObject({ lane: "stage" });
    const rank = (placed as { rank: string }).rank;
    expect(rank > lane[0]!.rank && rank < lane[1]!.rank).toBe(true);
  });

  it("GivenATicket_WhenPlacedBelowTheLast_ThenItsRankSortsLast", () => {
    const rank = (reorderRank(lane[0]!, { below: "AI-3" }, lane) as { rank: string }).rank;
    expect(rank > lane[2]!.rank).toBe(true);
  });

  it("GivenTheBacklog_WhenReorderedInUpNext_ThenUpNextRanksAreUsed", () => {
    const up = [
      t("AI-1", { stage: "backlog", upNextRank: "0000000005" }),
      t("AI-2", { stage: "backlog", upNextRank: "0000000006" }),
    ];
    const placed = reorderRank(up[1]!, { above: "AI-1" }, up) as { lane: string; rank: string };
    expect(placed.lane).toBe("up_next");
    expect(placed.rank < "0000000005").toBe(true);
  });

  it("GivenAnAnchorInAnotherLaneOrProject_WhenReordered_ThenRefused", () => {
    const tickets = [t("AI-1"), t("AI-2", { stage: "in_progress" })];
    expect(reorderRank(tickets[0]!, { above: "AI-2" }, tickets)).toMatch(/lane/);
    expect(reorderRank(tickets[0]!, { above: "OPS-1" }, tickets)).toMatch(/not in this project/);
    expect(reorderRank(tickets[0]!, { above: "AI-1" }, tickets)).toMatch(/itself/);
  });

  it("GivenIdeasAndUpNext_WhenAnchoredAcrossParts_ThenRefused", () => {
    const tickets = [
      t("AI-1", { stage: "backlog" }),
      t("AI-2", { stage: "backlog", upNextRank: "0000000001" }),
    ];
    expect(reorderRank(tickets[0]!, { below: "AI-2" }, tickets)).toMatch(/lane/);
  });
});

describe("parentProblem", () => {
  const epic = t("AI-1", { type: "epic" });
  const child = t("AI-2");

  it("GivenAnEpicInTheProject_WhenChecked_ThenAllowed", () => {
    expect(parentProblem(child, epic.id, [epic, child])).toBeNull();
  });

  it("GivenAParentOutsideTheProject_WhenChecked_ThenRefused", () => {
    expect(parentProblem(child, "other", [epic, child])).toMatch(/not in this project/);
  });

  it("GivenANonEpicParent_WhenChecked_ThenRefused", () => {
    expect(parentProblem(child, "AI-3", [child, t("AI-3")])).toMatch(/not an epic/);
  });

  it("GivenACycle_WhenChecked_ThenRefused", () => {
    const outer = t("AI-4", { type: "epic" });
    const inner = t("AI-5", { type: "epic", parentId: outer.id });
    expect(parentProblem(outer, inner.id, [outer, inner])).toMatch(/already under/);
    expect(parentProblem(outer, outer.id, [outer])).toMatch(/own parent/);
  });
});

describe("blockerProblem", () => {
  it("GivenADirectCycle_WhenChecked_ThenRefused", () => {
    const a = t("AI-1", { blockedBy: ["AI-2"] });
    const b = t("AI-2");
    expect(blockerProblem(b, ["AI-1"], [a, b])).toMatch(/already waiting on AI-2/);
  });

  it("GivenALongerCycle_WhenChecked_ThenRefused", () => {
    const a = t("AI-1", { blockedBy: ["AI-2"] });
    const b = t("AI-2", { blockedBy: ["AI-3"] });
    const c = t("AI-3");
    expect(blockerProblem(c, ["AI-1"], [a, b, c])).toMatch(/already waiting on AI-3/);
  });

  it("GivenItself_WhenChecked_ThenRefused", () => {
    const a = t("AI-1");
    expect(blockerProblem(a, ["AI-1"], [a])).toMatch(/already waiting/);
  });

  it("GivenNoCycleOrAnExistingBlocker_WhenChecked_ThenAllowed", () => {
    const a = t("AI-1", { blockedBy: ["AI-2"] });
    const b = t("AI-2", { blockedBy: ["AI-1"] });
    const c = t("AI-3");
    expect(blockerProblem(c, ["AI-1"], [a, b, c])).toBeNull();
    expect(blockerProblem(a, ["AI-2"], [a, b, c])).toBeNull();
  });
});
