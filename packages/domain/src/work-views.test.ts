import type { BoardTicket, Ticket } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { WORK_VIEWS, parseWorkView, workViewCounts, workViews } from "./work-views";

type Over = Partial<Omit<BoardTicket, "summary">> & { summary?: Partial<BoardTicket["summary"]> };

const ticket = (n: number, { summary, ...over }: Over = {}): BoardTicket =>
  ({
    id: `t${n}`,
    projectId: "ai",
    key: `AI-${n}`,
    title: `Ticket ${n}`,
    type: "feature",
    parentId: null,
    stage: "backlog",
    rank: String(n).padStart(10, "0"),
    archived: false,
    needsAttention: false,
    blockedBy: [],
    upNextRank: null,
    ...over,
    summary: { openQuestions: 0, run: null, pullRequest: null, worker: "agent", ...summary },
  }) as BoardTicket;

const views = (t: BoardTicket, others: Ticket[] = []) =>
  workViews(t, new Map([t, ...others].map((x) => [x.id, x])));

describe("workViews", () => {
  it("GivenAnOpenQuestion_WhenClassified_ThenItIsInNeedsMe", () => {
    expect(views(ticket(1, { summary: { openQuestions: 2 } }))).toContain("needs-me");
  });

  it("GivenAFlaggedTicket_WhenClassified_ThenItIsInNeedsMe", () => {
    expect(views(ticket(1, { needsAttention: true }))).toContain("needs-me");
  });

  it("GivenAWorkerStillToPick_WhenClassified_ThenItIsInNeedsMeOnly", () => {
    expect(views(ticket(1, { summary: { worker: "ask" } }))).toEqual(["needs-me"]);
  });

  it("GivenAnEpicWithWorkerAsk_WhenClassified_ThenItIsInNoView", () => {
    expect(views(ticket(1, { type: "epic", summary: { worker: "ask" } }))).toEqual([]);
  });

  it("GivenAndyIsTheWorker_WhenClassified_ThenItIsMine", () => {
    expect(views(ticket(1, { summary: { worker: "me" } }))).toEqual(["mine"]);
  });

  it("GivenAnAgentWorker_WhenClassified_ThenItIsInAgents", () => {
    expect(views(ticket(1))).toEqual(["agents"]);
  });

  it("GivenAnEpic_WhenClassified_ThenItIsNeverMineOrAgents", () => {
    expect(views(ticket(1, { type: "epic", summary: { worker: "me" } }))).toEqual([]);
    expect(views(ticket(2, { type: "epic" }))).toEqual([]);
  });

  it("GivenABlockerNotDone_WhenClassified_ThenItIsBlocked", () => {
    const blocker = ticket(2, { stage: "in_progress" });
    expect(views(ticket(1, { blockedBy: ["AI-2"] }), [blocker])).toContain("blocked");
  });

  it("GivenOnlyDoneOrCancelledBlockers_WhenClassified_ThenItIsNotBlocked", () => {
    const done = ticket(2, { stage: "done" });
    const cancelled = ticket(3, { stage: "cancelled" });
    expect(views(ticket(1, { blockedBy: ["AI-2", "t3"] }), [done, cancelled])).not.toContain(
      "blocked",
    );
  });

  it("GivenReadyForReview_WhenClassified_ThenItIsInReview", () => {
    expect(views(ticket(1, { stage: "ready_for_review" }))).toEqual(["agents", "in-review"]);
  });

  it.each([{ stage: "done" as const }, { stage: "cancelled" as const }, { archived: true }])(
    "GivenAClosedTicket %o_WhenClassified_ThenItIsInNoView",
    (over) => {
      expect(
        views(ticket(1, { ...over, needsAttention: true, stage: over.stage ?? "ready" })),
      ).toEqual([]);
    },
  );
});

describe("workViewCounts", () => {
  it("GivenABoard_WhenCounted_ThenEachViewCountsItsOpenTickets", () => {
    const tickets = [
      ticket(1, { summary: { openQuestions: 1 } }),
      ticket(2, { summary: { worker: "me" } }),
      ticket(3, { stage: "ready_for_review" }),
      ticket(4, { stage: "done" }),
    ];
    const byId = new Map(tickets.map((t) => [t.id, t]));
    expect(workViewCounts(tickets, byId)).toEqual({
      "needs-me": 1,
      mine: 1,
      agents: 2,
      blocked: 0,
      "in-review": 1,
    });
  });
});

describe("parseWorkView", () => {
  it.each(WORK_VIEWS)("GivenTheKnownView %s_WhenParsed_ThenItIsKept", (view) => {
    expect(parseWorkView(view)).toBe(view);
  });

  it.each([undefined, "", "everything", 3, ["mine"]])(
    "GivenTheUnknownValue %o_WhenParsed_ThenItIsNull",
    (value) => {
      expect(parseWorkView(value)).toBeNull();
    },
  );
});
