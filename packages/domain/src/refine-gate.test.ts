import {
  Assumption,
  InMemoryWorkTracker,
  type RefineGap,
  type RefineOutput,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_OPEN_QUESTIONS_PER_TICKET,
  RefineGate,
  planGaps,
  refineFills,
  shouldAsk,
} from "./refine-gate";

const gap = (question: string, over: Partial<RefineGap> = {}): RefineGap => ({
  question,
  assumption: `assume ${question}`,
  options: [],
  context: "Context for the question.",
  recommendation: { answer: "yes", reason: "the simplest" },
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

describe("refineFills scores", () => {
  const empty = {
    type: "feature",
    size: "S",
    body: "b",
    outOfScope: ["x"],
    touches: ["y"],
    acceptanceCriteria: ["z"],
    risk: null,
    riskReason: null,
    confidence: null,
    confidenceReason: null,
  } as unknown as Ticket;
  const output = {
    risk: "high",
    riskReason: "touches auth",
    confidence: "medium",
    confidenceReason: "one guess",
  } as RefineOutput;

  it("GivenNoScores_WhenFilled_ThenRiskAndConfidenceComeWithTheirReasons", () => {
    expect(refineFills(empty, output)).toMatchObject({
      risk: "high",
      riskReason: "touches auth",
      confidence: "medium",
      confidenceReason: "one guess",
    });
  });

  it("GivenASetRisk_WhenFilled_ThenRiskAndItsReasonStayAndConfidenceIsStillFilled", () => {
    const fills = refineFills({ ...empty, risk: "low", riskReason: "mine" }, output);
    expect(fills).not.toHaveProperty("risk");
    expect(fills).not.toHaveProperty("riskReason");
    expect(fills).toMatchObject({ confidence: "medium" });
  });

  it("GivenASetConfidence_WhenFilled_ThenConfidenceAndItsReasonStay", () => {
    const fills = refineFills({ ...empty, confidence: "high", confidenceReason: "mine" }, output);
    expect(fills).not.toHaveProperty("confidence");
    expect(fills).not.toHaveProperty("confidenceReason");
  });
});

describe("RefineGate.askHeld (AI-75)", () => {
  const at = "2026-11-11T09:00:00.000Z";
  const held = (n: number, over: Partial<Assumption> = {}): Assumption =>
    Assumption.parse({
      id: `run-1-a${n}`,
      text: `assume ${n}`,
      question: `Question ${n}?`,
      cost: "scope",
      confidence: "unsure",
      demotedBy: "daily_cap",
      runId: "run-1",
      createdAt: at,
      ...over,
    });

  async function setup(assumptions: Assumption[], dailyQuestionCap = 5) {
    // Ticks, so every write gets a new `updatedAt` and a stale claim conflicts.
    let ms = Date.parse(at);
    const clock = () => new Date(ms++);
    const tracker = new InMemoryWorkTracker(clock);
    const project = await tracker.createProject({ name: "AI", key: "AI", repos: [] });
    await tracker.updateProject(project.id, { dailyQuestionCap });
    const made = await tracker.createTicket(project.id, { title: "Board" }, "andy");
    await tracker.updateTicket(
      project.id,
      made.id,
      { fields: { upNextRank: "0000000001", refineAssumptions: assumptions } },
      "system",
    );
    const gate = new RefineGate(tracker, clock);
    const ticket = async () => (await tracker.getTicket(project.id, made.id))!;
    const open = () => tracker.listQuestions({ ticketId: made.id, status: "open" });
    return { tracker, project, gate, ticket, open };
  }

  beforeEach(() => void vi.spyOn(console, "log").mockImplementation(() => {}));

  it("GivenThreeHeldGapsAndADailyCapOfTwo_WhenAsked_ThenOnlyTwoBecomeQuestions", async () => {
    const t = await setup([held(1), held(2), held(3)], 2);
    expect(await t.gate.askHeld(await t.ticket())).toBe(2);
    expect((await t.open()).map((q) => q.text)).toEqual(["Question 1?", "Question 2?"]);
    const after = await t.ticket();
    expect(after.refineAssumptions.map((a) => a.status)).toEqual([
      "promoted",
      "promoted",
      "assumed",
    ]);
    expect(after).toMatchObject({ needsAttention: true, dorStatus: "not_met" });
    // The asked ones count against the cap: asking again finds no room.
    expect(await t.gate.askHeld(after)).toBe(0);
  });

  it("GivenACheapOrUndemotedGap_WhenAsked_ThenNothingIsAsked", async () => {
    const t = await setup([held(1, { cost: "reversible" }), held(2, { demotedBy: null })]);
    expect(await t.gate.askHeld(await t.ticket())).toBe(0);
    expect(await t.open()).toEqual([]);
  });

  it("GivenAClaimWhoseAskWasLost_WhenAskedAgainWithTheCapSpent_ThenItIsAskedOnceWithTheClaimedId", async () => {
    const t = await setup([held(1)], 1);
    const before = await t.ticket();
    // A crash after the claim landed and before the ask: the gap is promoted, no question yet.
    await t.tracker.updateTicket(
      t.project.id,
      before.id,
      {
        fields: {
          refineAssumptions: [{ ...held(1), status: "promoted", questionId: "run-1-a1-h1-q1" }],
        },
      },
      "system",
    );
    expect(await t.gate.askHeld(await t.ticket())).toBe(1);
    expect(await t.gate.askHeld(await t.ticket())).toBe(0);
    const open = await t.open();
    expect(open.map((q) => q.id)).toEqual(["run-1-a1-h1-q1"]);
  });

  it("GivenTwoOverlappingDispatchEvents_WhenBothAskTheSameHeldGap_ThenOneQuestionIsAsked", async () => {
    const t = await setup([held(1)]);
    const same = await t.ticket();
    await Promise.all([t.gate.askHeld(same), t.gate.askHeld(same)]);
    // A later event with the ticket as written: nothing more to ask.
    await t.gate.askHeld(await t.ticket());
    expect(await t.open()).toHaveLength(1);
    expect((await t.ticket()).refineAssumptions[0]).toMatchObject({
      status: "promoted",
      questionId: "run-1-a1-h1-q1",
    });
  });

  it("GivenAWithdrawnEarlierTry_WhenAskedAgain_ThenANewQuestionIsAsked", async () => {
    const t = await setup([held(1)]);
    await t.gate.askHeld(await t.ticket());
    const [first] = await t.open();
    await t.tracker.withdrawQuestion(first!.id, "system");
    const back = await t.ticket();
    await t.tracker.updateTicket(
      t.project.id,
      back.id,
      { fields: { refineAssumptions: [held(1)] } },
      "system",
    );
    expect(await t.gate.askHeld(await t.ticket())).toBe(1);
    const [second] = await t.open();
    expect(second!.id).not.toBe(first!.id);
    expect(second!.runId).toBe("run-1-a1-h2");
  });

  it("GivenAnIdea_WhenAsked_ThenNothingIsAsked", async () => {
    const t = await setup([held(1)]);
    const ticket = await t.ticket();
    expect(await t.gate.askHeld({ ...ticket, upNextRank: null })).toBe(0);
  });
});
