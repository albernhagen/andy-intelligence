import type { RefineGap } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { MAX_OPEN_QUESTIONS_PER_TICKET, planGaps, shouldAsk } from "./refine-gate";

const gap = (question: string, over: Partial<RefineGap> = {}): RefineGap => ({
  question,
  assumption: `assume ${question}`,
  options: [],
  suggestedAnswer: null,
  cost: "reversible",
  confidence: "sure",
  urgency: "normal",
  ...over,
});
const costly = (q: string) => gap(q, { cost: "scope" });
const room = { openOnTicket: 0, openedToday: 0, dailyCap: 5 };

describe("shouldAsk", () => {
  it.each([
    ["reversible", "sure", false],
    ["reversible", "unsure", true],
    ["direction", "sure", true],
    ["scope", "sure", true],
    ["trust", "sure", true],
    ["spend", "unsure", true],
  ] as const)("GivenCost%sAndConfidence%s_WhenRated_ThenAskIs%s", (cost, confidence, ask) => {
    expect(shouldAsk({ cost, confidence })).toBe(ask);
  });
});

describe("planGaps", () => {
  it("GivenSureCheapGaps_WhenPlanned_ThenAllAreAssumptionsAndNoneMarkedDemoted", () => {
    const plan = planGaps([gap("a"), gap("b")], room);
    expect(plan.questions).toEqual([]);
    expect(plan.assumptions.map((a) => a.demotedBy)).toEqual([null, null]);
  });

  it("GivenFourQuestionWorthyGaps_WhenPlanned_ThenThreeAskedAndTheRestDemotedByTheTicketCap", () => {
    const plan = planGaps(["a", "b", "c", "d"].map(costly), room);
    expect(plan.questions).toHaveLength(MAX_OPEN_QUESTIONS_PER_TICKET);
    expect(plan.assumptions.map((a) => [a.gap.question, a.demotedBy])).toEqual([
      ["d", "ticket_cap"],
    ]);
  });

  it("GivenOpenQuestionsOnTheTicket_WhenPlanned_ThenTheyCountAgainstTheTicketCap", () => {
    const plan = planGaps(["a", "b"].map(costly), { ...room, openOnTicket: 2 });
    expect(plan.questions.map((q) => q.question)).toEqual(["a"]);
  });

  it("GivenADailyCapNearlyReached_WhenPlanned_ThenExtrasAreDemotedByTheDailyCap", () => {
    const plan = planGaps(["a", "b"].map(costly), { ...room, openedToday: 4 });
    expect(plan.questions.map((q) => q.question)).toEqual(["a"]);
    expect(plan.assumptions[0]).toMatchObject({ demotedBy: "daily_cap" });
  });

  it("GivenACapOfZero_WhenPlanned_ThenNothingIsAsked", () => {
    expect(planGaps([costly("a")], { ...room, dailyCap: 0 }).questions).toEqual([]);
  });

  it("GivenCostlyAfterUnsureCheapGaps_WhenSlotsRunOut_ThenCostlyOnesAreAskedFirst", () => {
    const unsure = (q: string) => gap(q, { confidence: "unsure" });
    const plan = planGaps([unsure("cheap"), costly("big")], { ...room, dailyCap: 1 });
    expect(plan.questions.map((q) => q.question)).toEqual(["big"]);
  });
});
