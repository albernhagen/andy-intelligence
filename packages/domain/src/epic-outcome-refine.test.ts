import { RefineOutput, type Ticket } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { refineFills } from "./refine-gate";

/** AI-197: M4.31: refine writes an epic's outcome, only where the epic has none (ADR-0108). */

const output = (over: Partial<RefineOutput> = {}): RefineOutput => ({
  summary: "s",
  type: "epic",
  size: "L",
  sizeReason: "many slices",
  risk: "low",
  riskReason: "r",
  confidence: "high",
  confidenceReason: "r",
  outOfScope: [],
  touches: [],
  body: null,
  acceptanceCriteria: [],
  epicOutcome: "Andy sees every milestone at a glance.",
  outcome: "ready",
  reason: null,
  children: [],
  gaps: [],
  ...over,
});

const ticket = (over: Partial<Ticket>) =>
  ({
    type: "epic",
    size: null,
    risk: null,
    confidence: null,
    outOfScope: [],
    touches: [],
    body: "",
    acceptanceCriteria: [],
    outcome: null,
    ...over,
  }) as Ticket;

describe("refine and an epic's outcome", () => {
  it("GivenAnEpicWithNoOutcome_WhenRefineProposesOne_ThenItIsFilled", () => {
    expect(refineFills(ticket({}), output()).outcome).toBe(
      "Andy sees every milestone at a glance.",
    );
  });

  it("GivenAnEpicWithAnOutcome_WhenRefineProposesAnother_ThenItIsLeftUnchanged", () => {
    expect(refineFills(ticket({ outcome: "Andy's own words." }), output())).not.toHaveProperty(
      "outcome",
    );
  });

  it("GivenAnUntypedTicket_WhenRefineTypesItAnEpic_ThenTheOutcomeIsFilledWithTheType", () => {
    const fills = refineFills(ticket({ type: null }), output());
    expect(fills).toMatchObject({
      type: "epic",
      outcome: "Andy sees every milestone at a glance.",
    });
  });

  it("GivenAFeature_WhenRefineReturnsAnOutcome_ThenItIsIgnored", () => {
    expect(refineFills(ticket({ type: "feature" }), output())).not.toHaveProperty("outcome");
    expect(refineFills(ticket({ type: null }), output({ type: "feature" }))).not.toHaveProperty(
      "outcome",
    );
  });

  it("GivenAnOutcomeOver300Characters_WhenTheOutputIsChecked_ThenItIsRejected", () => {
    expect(RefineOutput.safeParse(output({ epicOutcome: "x".repeat(301) })).success).toBe(false);
    expect(RefineOutput.safeParse(output({ epicOutcome: "x".repeat(300) })).success).toBe(true);
  });

  it("GivenAnOutputWrittenBeforeTheField_WhenChecked_ThenItParsesWithANullOutcome", () => {
    const { epicOutcome: _omitted, ...old } = output();
    void _omitted;
    expect(RefineOutput.parse(old).epicOutcome).toBeNull();
  });
});
