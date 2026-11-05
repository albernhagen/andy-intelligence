import { describe, expect, it } from "vitest";
import type { Question, Ticket, TicketEvent } from "@andy/contracts";
import { describeEvent, groupByStage, linesToList, moveOptions, sortQuestions } from "./tickets";

const ticket = (over: Partial<Ticket>) =>
  ({ id: "t", stage: "backlog", rank: "m", ...over }) as Ticket;
const event = (over: Partial<TicketEvent>) =>
  ({ kind: "created", data: {}, body: null, ...over }) as TicketEvent;
const question = (over: Partial<Question>) =>
  ({ urgency: "normal", createdAt: "2026-11-01T00:00:00.000Z", ...over }) as Question;

describe("groupByStage", () => {
  it("GivenTicketsInTwoStages_WhenGrouped_ThenEveryStageHasAColumnSortedByRank", () => {
    const groups = groupByStage([
      ticket({ id: "b", rank: "n" }),
      ticket({ id: "a", rank: "a" }),
      ticket({ id: "c", stage: "done" }),
    ]);
    expect(Object.keys(groups)).toEqual([
      "backlog",
      "ready",
      "in_progress",
      "ready_for_review",
      "monitoring",
      "done",
    ]);
    expect(groups.backlog.map((t) => t.id)).toEqual(["a", "b"]);
    expect(groups.done.map((t) => t.id)).toEqual(["c"]);
    expect(groups.ready).toEqual([]);
  });
});

describe("moveOptions", () => {
  it("GivenReady_WhenListingMoves_ThenDomainMovesAreAllowedAndEveryOtherStageCanBeForced", () => {
    expect(moveOptions("ready")).toEqual({
      allowed: ["in_progress", "backlog"],
      forced: ["backlog", "in_progress", "ready_for_review", "monitoring", "done"],
    });
  });

  it("GivenDone_WhenListingMoves_ThenOnlyForcedMovesExist", () => {
    const { allowed, forced } = moveOptions("done");
    expect(allowed).toEqual([]);
    expect(forced).not.toContain("done");
    expect(forced).toHaveLength(5);
  });
});

describe("linesToList", () => {
  it("GivenBlankAndPaddedLines_WhenSplit_ThenOnlyTrimmedItemsRemain", () => {
    expect(linesToList("  a \n\n b\n   ")).toEqual(["a", "b"]);
  });
});

describe("describeEvent", () => {
  it("GivenAForcedStageChange_WhenDescribed_ThenItSaysForceMovedWithLabels", () => {
    const e = event({ kind: "stage_changed", data: { from: "backlog", to: "done", forced: true } });
    expect(describeEvent(e)).toBe("force-moved Backlog → Done");
  });

  it("GivenAFieldsChange_WhenDescribed_ThenItListsTheChangedFields", () => {
    const e = event({ kind: "fields_changed", data: { diff: { title: {}, body: {} } } });
    expect(describeEvent(e)).toBe("changed title, body");
  });

  it("GivenALinkedPullRequest_WhenDescribed_ThenItNamesTheNumberAndState", () => {
    const e = event({ kind: "pr_linked", data: { number: 70, state: "merged", url: "u" } });
    expect(describeEvent(e)).toBe("linked pull request #70 (merged)");
    expect(describeEvent(event({ kind: "pr_linked", data: {} }))).toBe("linked a pull request");
  });
});

describe("sortQuestions", () => {
  it("GivenMixedUrgency_WhenSorted_ThenHighFirstThenOldestFirst", () => {
    const sorted = sortQuestions([
      question({ id: "late", createdAt: "2026-11-02T00:00:00.000Z" }),
      question({ id: "low", urgency: "low" }),
      question({ id: "early" }),
      question({ id: "urgent", urgency: "high", createdAt: "2026-11-03T00:00:00.000Z" }),
    ]);
    expect(sorted.map((q) => q.id)).toEqual(["urgent", "early", "late", "low"]);
  });
});
