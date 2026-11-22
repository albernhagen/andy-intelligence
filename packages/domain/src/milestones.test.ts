import { describe, expect, it } from "vitest";
import { milestoneOf, milestoneReorder, topLevelOf } from "./milestones";

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

describe("milestoneReorder (AI-324)", () => {
  const list = (...orders: number[]) => orders.map((order, i) => ({ id: `m${i}`, order }));
  /** The ids in the order the writes leave them. */
  const after = (ms: { id: string; order: number }[], writes: { id: string; order: number }[]) => {
    const orders = new Map(ms.map((m) => [m.id, m.order]));
    for (const w of writes) orders.set(w.id, w.order);
    return [...orders].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  };

  it("GivenRoomBetweenNeighbours_WhenMovedUp_ThenOneWriteBetweenThem", () => {
    const ms = list(0, 10, 20);

    const writes = milestoneReorder(ms, "m2", 1);

    expect(writes).toEqual([{ id: "m2", order: 5 }]);
    expect(after(ms, writes)).toEqual(["m0", "m2", "m1"]);
  });

  it("GivenAMoveToTheTopOrBottom_WhenReordered_ThenOneWritePastTheEnd", () => {
    const ms = list(10, 20, 30);

    expect(milestoneReorder(ms, "m2", 0)).toEqual([{ id: "m2", order: 0 }]);
    expect(milestoneReorder(ms, "m0", 2)).toEqual([{ id: "m0", order: 40 }]);
  });

  it("GivenNoRoom_WhenMoved_ThenOnlyChangedMilestonesAreRenumbered", () => {
    const ms = list(0, 1, 1);

    const writes = milestoneReorder(ms, "m2", 0);

    expect(after(ms, writes)).toEqual(["m2", "m0", "m1"]);
    expect(writes).toEqual([
      { id: "m2", order: 0 },
      { id: "m0", order: 10 },
      { id: "m1", order: 20 },
    ]);
  });

  it("GivenItsOwnPositionOrAnUnknownId_WhenMoved_ThenNothingIsWritten", () => {
    const ms = list(0, 10);

    expect(milestoneReorder(ms, "m1", 1)).toEqual([]);
    expect(milestoneReorder(ms, "nope", 0)).toEqual([]);
  });
});
