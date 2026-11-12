import type { Ticket } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import {
  boardEpics,
  epicOf,
  epicProgress,
  groupByEpic,
  inEpic,
  loadGroupByEpic,
  sameGroup,
  saveGroupByEpic,
} from "./board-groups";

const ticket = (
  key: string,
  fields: Partial<Pick<Ticket, "type" | "parentId" | "stage">> = {},
): Ticket =>
  ({ id: key, key, type: "feature", parentId: null, stage: "ready", ...fields }) as Ticket;

const epic10 = ticket("AI-10", { type: "epic", stage: "in_progress" });
const epic9 = ticket("AI-9", { type: "epic", stage: "backlog" });
const feature = ticket("AI-3");
const a = ticket("AI-11", { parentId: "AI-10" });
const b = ticket("AI-12", { parentId: "AI-9", stage: "done" });
const c = ticket("AI-13", { parentId: "AI-10", stage: "done" });
const underFeature = ticket("AI-14", { parentId: "AI-3" });
const cancelled = ticket("AI-15", { parentId: "AI-10", stage: "cancelled" });
const all = [epic10, epic9, feature, a, b, c, underFeature, cancelled];
const byId = new Map(all.map((t) => [t.id, t]));

describe("board groups", () => {
  it("GivenAParentThatIsAnEpic_WhenAskedForTheEpic_ThenItIsTheParent", () => {
    expect(epicOf(a, byId)?.key).toBe("AI-10");
  });

  it("GivenAParentThatIsNotAnEpic_WhenAskedForTheEpic_ThenThereIsNone", () => {
    expect(epicOf(underFeature, byId)).toBeNull();
    expect(epicOf(feature, byId)).toBeNull();
  });

  it("GivenEpicsOutOfOrder_WhenListed_ThenTheyAreInKeyNumberOrder", () => {
    expect(boardEpics(all).map((t) => t.key)).toEqual(["AI-9", "AI-10"]);
  });

  it("GivenALaneOfMixedCards_WhenGrouped_ThenOneGroupPerEpicInKeyOrderAndNoEpicLast", () => {
    const groups = groupByEpic([feature, a, b, underFeature, c], byId);
    expect(groups.map((g) => g.epic?.key ?? null)).toEqual(["AI-9", "AI-10", null]);
    expect(groups.map((g) => g.cards.map((t) => t.key))).toEqual([
      ["AI-12"],
      ["AI-11", "AI-13"],
      ["AI-3", "AI-14"],
    ]);
  });

  it("GivenNoCards_WhenGrouped_ThenThereAreNoGroups", () => {
    expect(groupByEpic([], byId)).toEqual([]);
  });

  it("GivenAnEpicWithACancelledChild_WhenProgressIsCounted_ThenCancelledIsLeftOut", () => {
    expect(epicProgress("AI-10", all)).toEqual({ done: 1, total: 2 });
  });

  it("GivenTwoCards_WhenComparedForAGroup_ThenTheSameEpicMatchesAndNoEpicMatchesNoEpic", () => {
    expect(sameGroup(a, c, byId)).toBe(true);
    expect(sameGroup(a, b, byId)).toBe(false);
    expect(sameGroup(feature, underFeature, byId)).toBe(true);
  });

  it("GivenAnEpicFilter_WhenTicketsAreChecked_ThenOnlyItsChildrenPass", () => {
    expect(all.filter((t) => inEpic(t, "AI-10")).map((t) => t.key)).toEqual([
      "AI-11",
      "AI-13",
      "AI-15",
    ]);
    expect(all.filter((t) => inEpic(t, null))).toHaveLength(all.length);
  });

  it("GivenTheChoiceSaved_WhenLoaded_ThenItIsKept", () => {
    expect(loadGroupByEpic()).toBe(false);
    saveGroupByEpic(true);
    expect(loadGroupByEpic()).toBe(true);
    saveGroupByEpic(false);
    expect(loadGroupByEpic()).toBe(false);
  });
});
