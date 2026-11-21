import { describe, expect, it } from "vitest";
import { milestoneOf, topLevelOf } from "./milestones";

/** AI-302: M4.33: Milestone entity and store (ADR-0131). */

type T = Parameters<typeof milestoneOf>[0] & { key: string };
const t = (over: Partial<T> & Pick<T, "id">): T => ({
  key: over.id.toUpperCase(),
  type: "feature",
  parentId: null,
  milestoneId: null,
  ...over,
});

const top = t({ id: "e1", type: "epic", milestoneId: "m1" });
const child = t({ id: "e2", type: "epic", parentId: "e1", milestoneId: "stale" });
const story = t({ id: "s1", parentId: "e2" });
const direct = t({ id: "s2", parentId: "e1" });
const loose = t({ id: "s3" });
const all = [top, child, story, direct, loose];

describe("milestoneOf", () => {
  it("GivenATopLevelEpicWithAMilestone_WhenRead_ThenItsChildEpicsAndTicketsShareIt", () => {
    for (const ticket of [top, child, story, direct]) expect(milestoneOf(ticket, all)).toBe("m1");
  });

  it("GivenNoEpicOrAnEpicWithoutAMilestone_WhenRead_ThenNone", () => {
    expect(milestoneOf(loose, all)).toBeNull();
    const bare = t({ id: "e9", type: "epic" });
    expect(milestoneOf(t({ id: "s9", parentId: "e9" }), [bare])).toBeNull();
  });

  it("GivenAStaleIdOnANonEpicTopLevelTicket_WhenRead_ThenIgnored", () => {
    expect(milestoneOf(t({ id: "x", type: "feature", milestoneId: "m1" }), [])).toBeNull();
  });

  it("GivenAParentMissingOrACycle_WhenWalked_ThenStopsWithoutLooping", () => {
    expect(topLevelOf(t({ id: "o", parentId: "gone" }), []).id).toBe("o");
    const a = t({ id: "a", type: "epic", parentId: "b", milestoneId: "ma" });
    const b = t({ id: "b", type: "epic", parentId: "a", milestoneId: "mb" });
    expect(topLevelOf(a, [a, b]).id).toBe("b");
    expect(milestoneOf(a, [a, b])).toBe("mb");
  });
});
