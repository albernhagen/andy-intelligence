import type { Run, Ticket } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { MAX_EPIC_COST_READS, dependencyOrder, epicChildren, readEpicRollup } from "./epic-rollup";

const ticket = (n: number, over: Partial<Ticket> = {}): Ticket =>
  ({
    id: `t${n}`,
    projectId: "ai",
    key: `AI-${n}`,
    title: `Ticket ${n}`,
    type: "feature",
    parentId: "t0",
    stage: "backlog",
    rank: String(n).padStart(10, "0"),
    size: "M",
    archived: false,
    blockedBy: [],
    ...over,
  }) as Ticket;

const epic = ticket(0, { type: "epic", parentId: null, title: "The epic" });
const run = (over: Partial<Run>) =>
  ({ status: "succeeded", costUsd: null, quotaDelta: null, ...over }) as Run;
const noRuns = async () => [];

describe("epic roll-up (AI-85)", () => {
  it("GivenAChildBlockedByALaterRankedSibling_WhenOrdered_ThenItComesAfterItsBlocker", () => {
    const a = ticket(1, { blockedBy: ["t3"] });
    const b = ticket(2);
    const c = ticket(3);
    expect(dependencyOrder([a, b, c]).map((t) => t.key)).toEqual(["AI-2", "AI-3", "AI-1"]);
  });

  it("GivenAChain_WhenOrdered_ThenEachFollowsItsBlocker", () => {
    const a = ticket(1, { blockedBy: ["t2"] });
    const b = ticket(2, { blockedBy: ["t3"] });
    const c = ticket(3);
    expect(dependencyOrder([a, b, c]).map((t) => t.key)).toEqual(["AI-3", "AI-2", "AI-1"]);
  });

  it("GivenACycle_WhenOrdered_ThenItsTicketsFollowInRankOrder", () => {
    const a = ticket(1, { blockedBy: ["t2"] });
    const b = ticket(2, { blockedBy: ["t1"] });
    const c = ticket(3);
    expect(dependencyOrder([a, b, c]).map((t) => t.key)).toEqual(["AI-3", "AI-1", "AI-2"]);
  });

  it("GivenChildrenAndOtherTickets_WhenListed_ThenOnlyUnarchivedChildrenWithOpenBlockers", () => {
    const outside = ticket(9, { parentId: null, stage: "in_progress" });
    const doneBlocker = ticket(8, { parentId: null, stage: "done" });
    const child = ticket(1, { blockedBy: ["t9", "t8", "gone"] });
    const archived = ticket(2, { stage: "done", archived: true });

    const children = epicChildren(epic, [epic, outside, doneBlocker, child, archived]);

    expect(children).toEqual([
      {
        id: "t1",
        key: "AI-1",
        title: "Ticket 1",
        type: "feature",
        stage: "backlog",
        size: "M",
        openBlockers: ["AI-9", "gone"],
      },
    ]);
  });

  it("GivenDoneOpenAndCancelledChildren_WhenRolledUp_ThenProgressExcludesCancelledAndCostSums", async () => {
    const tickets = [
      epic,
      ticket(1, { stage: "done" }),
      ticket(2, { stage: "in_progress" }),
      ticket(3, { stage: "cancelled" }),
    ];
    const runs: Record<string, Run[]> = {
      t1: [run({ costUsd: 1.25 }), run({ costUsd: null })],
      t2: [run({ costUsd: 0.5 }), run({ status: "running", costUsd: null })],
    };

    const rollup = await readEpicRollup(epic, tickets, async (_, id) => runs[id] ?? []);

    expect(rollup.progress).toEqual({ done: 1, total: 2 });
    expect(rollup.cost).toEqual({ estimatedCostUsd: 1.75, completedRuns: 3, unknownRuns: 1 });
    expect(rollup).toMatchObject({ costedChildren: 3, partial: false });
  });

  it("GivenMoreChildrenThanTheReadCap_WhenRolledUp_ThenRunsAreReadForTheCapOnlyAndItSaysPartial", async () => {
    const children = Array.from({ length: MAX_EPIC_COST_READS + 2 }, (_, i) => ticket(i + 1));
    let reads = 0;

    const rollup = await readEpicRollup(epic, [epic, ...children], async () => {
      reads++;
      return [run({ costUsd: 1 })];
    });

    expect(reads).toBe(MAX_EPIC_COST_READS);
    expect(rollup.children).toHaveLength(MAX_EPIC_COST_READS + 2);
    expect(rollup.progress.total).toBe(MAX_EPIC_COST_READS + 2);
    expect(rollup).toMatchObject({ costedChildren: MAX_EPIC_COST_READS, partial: true });
    expect(rollup.cost.estimatedCostUsd).toBe(MAX_EPIC_COST_READS);
  });

  it("GivenAFeature_WhenRolledUp_ThenRefused", async () => {
    const feature = ticket(1);
    await expect(readEpicRollup(feature, [feature], noRuns)).rejects.toBeInstanceOf(DomainError);
  });

  it("GivenAnEpicWithNoChildren_WhenRolledUp_ThenEmptyAndNotPartial", async () => {
    expect(await readEpicRollup(epic, [epic], noRuns)).toEqual({
      children: [],
      progress: { done: 0, total: 0 },
      cost: { estimatedCostUsd: 0, completedRuns: 0, unknownRuns: 0 },
      costedChildren: 0,
      partial: false,
    });
  });
});
