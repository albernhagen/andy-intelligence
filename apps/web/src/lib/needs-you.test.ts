import { describe, expect, it } from "vitest";
import type { Question, Ticket } from "@andy/contracts";
import { inboxItems, waitingCounts } from "./needs-you";

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

  it("GivenItemsInTwoProjects_WhenCounted_ThenTotalAndPerProjectCountsMatchTheInbox", () => {
    const counts = waitingCounts(data);
    expect(counts.total).toBe(4);
    expect(Object.fromEntries(counts.byProject)).toEqual({ ai: 3, ops: 1 });
  });
});
