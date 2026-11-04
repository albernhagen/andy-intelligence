import { describe, expect, it } from "vitest";
import type { Question, Ticket, TicketEvent } from "@andy/contracts";
import {
  canArchive,
  describeEvent,
  groupByStage,
  linesToList,
  moveOptions,
  sortQuestions,
  visibleTickets,
} from "./tickets";

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
      "cancelled",
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

  it("GivenCancelled_WhenListingMoves_ThenReopenToBacklogIsAllowedAndCancelledIsNeverForced", () => {
    expect(moveOptions("cancelled").allowed).toEqual(["backlog"]);
    expect(moveOptions("ready").forced).not.toContain("cancelled");
  });
});

describe("visibleTickets and canArchive", () => {
  it("GivenAnArchivedTicket_WhenTheToggleIsOffOrOn_ThenItIsHiddenOrListed", () => {
    const tickets = [ticket({ id: "a" }), ticket({ id: "b", archived: true })];
    expect(visibleTickets(tickets, false).map((t) => t.id)).toEqual(["a"]);
    expect(visibleTickets(tickets, true).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("GivenEachStage_WhenCheckingArchive_ThenOnlyDoneAndCancelledCanBeArchived", () => {
    expect(canArchive({ stage: "done" })).toBe(true);
    expect(canArchive({ stage: "cancelled" })).toBe(true);
    expect(canArchive({ stage: "monitoring" })).toBe(false);
  });
});

describe("linesToList", () => {
  it("GivenBlankAndPaddedLines_WhenSplit_ThenOnlyTrimmedItemsRemain", () => {
    expect(linesToList("  a \n\n b\n   ")).toEqual(["a", "b"]);
  });
});

describe("describeEvent", () => {
  it("GivenAnArchiveChange_WhenDescribed_ThenItSaysArchivedOrUnarchived", () => {
    const diff = (to: boolean) => ({ diff: { archived: { from: !to, to } } });
    expect(describeEvent(event({ kind: "fields_changed", data: diff(true) }))).toBe(
      "archived the ticket",
    );
    expect(describeEvent(event({ kind: "fields_changed", data: diff(false) }))).toBe(
      "unarchived the ticket",
    );
  });

  it("GivenAForcedStageChange_WhenDescribed_ThenItSaysForceMovedWithLabels", () => {
    const e = event({ kind: "stage_changed", data: { from: "backlog", to: "done", forced: true } });
    expect(describeEvent(e)).toBe("force-moved Backlog → Done");
  });

  it("GivenAFieldsChange_WhenDescribed_ThenItListsTheChangedFields", () => {
    const e = event({ kind: "fields_changed", data: { diff: { title: {}, body: {} } } });
    expect(describeEvent(e)).toBe("changed title, body");
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
