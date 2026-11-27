import type { Milestone, Ticket } from "@andy/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { matchesText } from "./board-groups";
import {
  IDEAS_SHOWN,
  groupIdeas,
  ideaGroupKey,
  ideaRows,
  loadIdeaCollapse,
  saveIdeaCollapse,
} from "./idea-groups";

const ticket = (
  key: string,
  fields: Partial<Pick<Ticket, "type" | "parentId" | "milestoneId" | "title">> = {},
): Ticket =>
  ({
    id: key,
    key,
    type: "feature",
    title: key,
    parentId: null,
    milestoneId: null,
    stage: "backlog",
    ...fields,
  }) as Ticket;
const milestone = (id: string, order: number, status: Milestone["status"]): Milestone =>
  ({ id, name: id, order, status }) as Milestone;

const parked = milestone("M6", 6, "parked");
const approved = milestone("M4", 4, "approved");
const epicA = ticket("AI-1", { type: "epic", milestoneId: "M6", title: "Releases" });
const epicB = ticket("AI-2", { type: "epic", milestoneId: "M4" });
const epicLoose = ticket("AI-3", { type: "epic" });
const inA = ticket("AI-10", { parentId: "AI-1" });
const inB = ticket("AI-11", { parentId: "AI-2" });
const inLoose = ticket("AI-12", { parentId: "AI-3" });
const loose = ticket("AI-13");
const all = [epicA, epicB, epicLoose, inA, inB, inLoose, loose];
const milestones = [parked, approved];

const open = { isCollapsed: (_: string, d: boolean) => d, shownInFull: new Set<string>() };

describe("groupIdeas", () => {
  it("GivenIdeasAcrossMilestones_WhenGrouped_ThenRoadmapOrderWithNoMilestoneLast", () => {
    const groups = groupIdeas([loose, inLoose, inA, inB], all, milestones);

    expect(groups.map((g) => g.key)).toEqual(["M4", "M6", "none"]);
    expect(groups.map((g) => g.count)).toEqual([1, 1, 2]);
    // An epic is its children's header, never a card (AI-403); a loose epic's child is under it.
    expect(groups[1]!.epics.map((e) => [e.epic?.key, e.cards.map((c) => c.key)])).toEqual([
      ["AI-1", ["AI-10"]],
    ]);
    expect(groups[2]!.epics.map((e) => e.epic?.key ?? null)).toEqual(["AI-3", null]);
  });

  it("GivenAMilestoneNotOnTheList_WhenGrouped_ThenItsIdeasFallUnderNoMilestone", () => {
    expect(groupIdeas([inA], all, []).map((g) => g.key)).toEqual(["none"]);
  });
});

describe("ideaRows", () => {
  it("GivenAParkedGroup_WhenNoChoiceIsStored_ThenItIsCollapsed", () => {
    const rows = ideaRows(groupIdeas([inA, inB], all, milestones), { ...open, filtering: false });

    expect(
      rows.map((r) => (r.kind === "card" ? r.card.key : `${r.kind}:${"open" in r && r.open}`)),
    ).toEqual(["milestone:true", "epic:true", "AI-11", "milestone:false"]);
  });

  it("GivenAFilter_WhenRowsAreBuilt_ThenEveryGroupIsOpen", () => {
    const rows = ideaRows(groupIdeas([inA], all, milestones), {
      isCollapsed: () => true,
      shownInFull: new Set(),
      filtering: true,
    });

    expect(rows.some((r) => r.kind === "card" && r.card.key === "AI-10")).toBe(true);
  });

  it("GivenMoreThanTenIdeasInAGroup_WhenRowsAreBuilt_ThenTenShowThenAShowAllRow", () => {
    const many = Array.from({ length: IDEAS_SHOWN + 2 }, (_, i) => ticket(`AI-${100 + i}`));
    const groups = groupIdeas(many, many, []);

    const rows = ideaRows(groups, { ...open, filtering: false });
    expect(rows.filter((r) => r.kind === "card")).toHaveLength(IDEAS_SHOWN);
    expect(rows.at(-1)).toEqual({ kind: "more", key: "none/none", total: IDEAS_SHOWN + 2 });

    const full = ideaRows(groups, {
      ...open,
      shownInFull: new Set(["none/none"]),
      filtering: false,
    });
    expect(full.filter((r) => r.kind === "card")).toHaveLength(IDEAS_SHOWN + 2);
  });
  it("GivenIdeasWithNoMilestoneAndNoEpic_WhenRowsAreBuilt_ThenNoHeadersShow", () => {
    const rows = ideaRows(groupIdeas([loose], all, milestones), { ...open, filtering: false });

    expect(rows).toEqual([{ kind: "card", card: loose }]);
  });
});

describe("ideaGroupKey", () => {
  it("GivenTwoIdeas_WhenUnderDifferentEpics_ThenTheirKeysDiffer", () => {
    expect(ideaGroupKey(inA, all, milestones)).toBe("M6/AI-1");
    expect(ideaGroupKey(inB, all, milestones)).toBe("M4/AI-2");
    expect(ideaGroupKey(loose, all, milestones)).toBe("none/none");
  });
});

describe("matchesText", () => {
  const byId = new Map(all.map((t) => [t.id, t]));

  it("GivenText_WhenMatched_ThenKeyTitleAndEpicTitleCountIgnoringCase", () => {
    expect(matchesText(inA, " releases ", byId)).toBe(true);
    expect(matchesText(inA, "ai-10", byId)).toBe(true);
    expect(matchesText(loose, "releases", byId)).toBe(false);
    expect(matchesText(loose, "", byId)).toBe(true);
    expect(matchesText(loose, undefined, byId)).toBe(true);
  });
});

describe("collapse choices", () => {
  afterEach(() => window.localStorage.clear());

  it("GivenChoicesSaved_WhenLoaded_ThenEachProjectKeepsItsOwn", () => {
    saveIdeaCollapse("ai", { M6: false });
    saveIdeaCollapse("other", { none: true });

    expect(loadIdeaCollapse("ai")).toEqual({ M6: false });
    expect(loadIdeaCollapse("other")).toEqual({ none: true });
  });

  it("GivenBrokenStorage_WhenLoaded_ThenNoChoices", () => {
    window.localStorage.setItem("andy.board.ideaGroups", "{not json");

    expect(loadIdeaCollapse("ai")).toEqual({});
  });
});
