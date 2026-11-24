import { describe, expect, it } from "vitest";
import type { Question, Ticket } from "@andy/contracts";
import { inboxCards, inboxItems, waitingCounts, withoutQuestion } from "./inbox-order";

const ticket = (id: string, projectId: string) => ({ id, projectId }) as Ticket;
const question = (id: string, ticketId: string, projectId: string) =>
  ({ id, ticketId, projectId }) as Question;

// AI-1 has two questions; AI-2 is flagged without one; OPS-1 has one question.
const data = {
  questions: [
    question("q1", "ai1", "ai"),
    question("q2", "ai1", "ai"),
    question("q3", "ops1", "ops"),
  ],
  tickets: [ticket("ai1", "ai"), ticket("ai2", "ai"), ticket("ops1", "ops")],
};

describe("needs you", () => {
  it("GivenFlaggedTicketsWithQuestions_WhenListed_ThenOnlyTicketsWithoutQuestionsAreFlaggedItems", () => {
    const { questions, flagged } = inboxItems(data);
    expect(questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(flagged.map((t) => t.id)).toEqual(["ai2"]);
  });

  it("GivenAProjectScope_WhenListed_ThenOnlyThatProjectsItems", () => {
    const { questions, flagged } = inboxItems(data, "ops");
    expect(questions.map((q) => q.id)).toEqual(["q3"]);
    expect(flagged).toEqual([]);
  });

  it("GivenATicketWithTwoQuestions_WhenCounted_ThenItCountsOnceLikeItsInboxCard", () => {
    const counts = waitingCounts(data);
    expect(counts.total).toBe(3);
    expect(counts.stale).toBe(0);
    expect(Object.fromEntries(counts.byProject)).toEqual({ ai: 2, ops: 1 });
  });

  it("GivenADoneTicketWithAQuestion_WhenCounted_ThenItIsInTheTotalAndCountedStale", () => {
    const done = { ...ticket("ai3", "ai"), stage: "done" } as Ticket;
    const counts = waitingCounts({
      questions: [...data.questions, question("q4", "ai3", "ai")],
      tickets: [...data.tickets, done],
    });
    expect(counts.total).toBe(4);
    expect(counts.stale).toBe(1);
    expect(Object.fromEntries(counts.byProject)).toEqual({ ai: 3, ops: 1 });
  });
});

const full = (id: string, fields: Partial<Ticket>) =>
  ({
    id,
    projectId: "ai",
    key: id.toUpperCase(),
    type: "chore",
    body: "Why",
    acceptanceCriteria: ["Done when it works"],
    size: "S",
    sizeReason: "small",
    stage: "backlog",
    rank: "0001",
    archived: false,
    upNextRank: null,
    upNextAt: null,
    sentBackReason: null,
    refineAssumptions: [],
    outcome: null,
    ...fields,
  }) as Ticket;
const ask = (
  id: string,
  ticketId: string,
  urgency: Question["urgency"],
  createdAt = "2026-11-05",
) => ({ id, ticketId, projectId: "ai", urgency, createdAt }) as Question;

describe("inbox cards", () => {
  it("GivenTicketsAcrossStages_WhenGrouped_ThenReadyAdjacentFirstThenLaterStagesThenOtherBacklogThenStale", () => {
    const tickets = [
      full("a", { size: null, rank: "0001" }), // backlog, more gaps than its questions
      full("b", { stage: "in_progress", rank: "0002" }),
      full("c", { rank: "0009" }), // backlog, only its questions block Ready
      full("d", { stage: "done" }),
      full("e", { archived: true, stage: "cancelled" }),
    ];
    const questions = tickets.map((t) => ask(`q${t.id}`, t.id, "normal"));
    const { active, stale } = inboxCards({ questions, tickets });
    expect(active.map((c) => c.ticketId)).toEqual(["c", "b", "a"]);
    expect(stale.map((c) => c.ticketId)).toEqual(["d", "e"]);
  });

  it("GivenEqualStageAndRank_WhenGrouped_ThenTheMostUrgentCardAndQuestionComeFirst", () => {
    const tickets = [full("a", {}), full("b", {})];
    const questions = [
      ask("q1", "a", "normal"),
      ask("q2", "b", "low"),
      ask("q3", "b", "high", "2026-11-06"),
    ];
    const { active } = inboxCards({ questions, tickets });
    expect(active.map((c) => c.ticketId)).toEqual(["b", "a"]);
    expect(active[0]?.questions.map((q) => q.id)).toEqual(["q3", "q2"]);
  });

  it("GivenAFlaggedTicketWithoutQuestions_WhenGrouped_ThenItIsACardWithNoQuestions", () => {
    const { active } = inboxCards({ questions: [], tickets: [full("a", {})] });
    expect(active).toMatchObject([{ ticketId: "a", questions: [] }]);
  });

  it("GivenTheLastQuestionOnATicket_WhenAnswered_ThenTheQuestionAndItsTicketLeave", () => {
    const after = withoutQuestion(data, "q3");
    expect(after.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(after.tickets.map((t) => t.id)).toEqual(["ai1", "ai2"]);
  });

  it("GivenAnotherQuestionStillOpen_WhenOneIsAnswered_ThenTheTicketStays", () => {
    const after = withoutQuestion(data, "q1");
    expect(after.questions.map((q) => q.id)).toEqual(["q2", "q3"]);
    expect(after.tickets).toHaveLength(3);
  });

  it("GivenTheReadCarriesWaitingMerges_WhenAQuestionIsAnswered_ThenTheyStay", () => {
    const merges = { merges: [], truncated: false };
    const after = withoutQuestion({ ...data, waitingMerges: merges }, "q3");
    expect(after.waitingMerges).toBe(merges);
  });
});
