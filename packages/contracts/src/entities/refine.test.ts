import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Confidence,
  GapConfidence,
  GapCost,
  QUESTION_FORMAT_LIMITS,
  REFINE_LIMITS,
  RefineOutput,
  Risk,
  SCORE_REASON_MAX,
  Size,
  TicketType,
} from "./index";

// The schema the executor hands the agent (`--json-schema`). It must stay in step with
// RefineOutput, which the control plane checks the result against.
const schemaText = readFileSync(
  new URL("../../../../platform/procedures/refine.schema.json", import.meta.url),
  "utf8",
);
const schema = JSON.parse(schemaText);
const item = schema.properties.gaps.items;

const gap = {
  question: "Which store should tickets live in?",
  context: "Tickets need a home. Today nothing stores them. The build starts with the store.",
  assumption: "Firestore",
  options: [{ label: "Firestore", consequence: "No server to run; scales to zero." }],
  recommendation: { answer: "Firestore", reason: "Scales to zero." },
  cost: "reversible",
  confidence: "sure",
};
const base = {
  summary: "s",
  type: "feature",
  size: "S",
  sizeReason: "one module",
  risk: "low",
  riskReason: "one package, no data",
  confidence: "high",
  confidenceReason: "the code answers every question",
  outOfScope: ["the UI"],
  touches: ["packages/domain/**"],
  body: null,
  acceptanceCriteria: [],
  outcome: "ready",
  reason: null,
  children: [],
  gaps: [gap],
};

describe("RefineOutput", () => {
  it("GivenTheAgentSchemaFile_WhenComparedWithTheLimits_ThenTheyMatch", () => {
    expect(schema.properties.summary.maxLength).toBe(REFINE_LIMITS.summary);
    expect(schema.properties.gaps.maxItems).toBe(REFINE_LIMITS.maxGaps);
    expect(schema.properties.children.maxItems).toBe(REFINE_LIMITS.maxChildren);
    expect(schema.properties.reason.maxLength).toBe(REFINE_LIMITS.reason);
    expect(item.properties.cost.enum).toEqual(GapCost.options);
    expect(item.properties.confidence.enum).toEqual(GapConfidence.options);
    expect(item.properties.question.maxLength).toBe(REFINE_LIMITS.text);
    expect(item.properties.assumption.maxLength).toBe(REFINE_LIMITS.assumption);
    expect(item.properties.options.maxItems).toBe(REFINE_LIMITS.maxOptions);
    const option = item.properties.options.items;
    expect(option.properties.label.maxLength).toBe(QUESTION_FORMAT_LIMITS.label);
    expect(option.properties.consequence.maxLength).toBe(QUESTION_FORMAT_LIMITS.consequence);
    expect(option.required).toEqual(["label", "consequence"]);
    expect(item.properties.context.maxLength).toBe(QUESTION_FORMAT_LIMITS.context);
    const rec = item.properties.recommendation;
    expect(rec.properties.answer.maxLength).toBe(QUESTION_FORMAT_LIMITS.label);
    expect(rec.properties.reason.maxLength).toBe(QUESTION_FORMAT_LIMITS.reason);
    expect(rec.required).toEqual(["answer", "reason"]);
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(schema.properties.sizeReason.maxLength).toBe(REFINE_LIMITS.sizeReason);
    expect(schema.properties.size.enum).toEqual(Size.options);
    expect(schema.properties.type.enum).toEqual(TicketType.options);
    expect(schema.properties.risk.enum).toEqual(Risk.options);
    expect(schema.properties.confidence.enum).toEqual(Confidence.options);
    expect(schema.properties.riskReason.maxLength).toBe(SCORE_REASON_MAX);
    expect(schema.properties.confidenceReason.maxLength).toBe(SCORE_REASON_MAX);
    for (const list of ["outOfScope", "touches"]) {
      expect(schema.properties[list].maxItems).toBe(REFINE_LIMITS.maxScopeItems);
      expect(schema.properties[list].items.maxLength).toBe(REFINE_LIMITS.scopeItem);
    }
    expect([...schema.required].sort()).toEqual(Object.keys(RefineOutput.shape).sort());
    expect(Object.keys(item.properties).sort()).toEqual(
      [
        "assumption",
        "confidence",
        "context",
        "cost",
        "options",
        "question",
        "recommendation",
        "urgency",
      ].sort(),
    );
  });

  it("GivenTheAgentSchemaFile_WhenPassedAsAShellArgument_ThenItHasNoSingleQuote", () => {
    // The workflow wraps the compact schema in single quotes inside claude_args.
    expect(schemaText).not.toContain("'");
  });

  it("GivenAValidResult_WhenParsed_ThenDefaultsAreFilledAndTextTrimmed", () => {
    const out = RefineOutput.parse({ ...base, summary: " ok " });
    expect(out.summary).toBe("ok");
    expect(out.gaps[0]).toEqual({ ...gap, urgency: "normal" });
  });

  it("GivenNoGaps_WhenParsed_ThenItIsValid", () => {
    expect(RefineOutput.safeParse({ ...base, gaps: [] }).success).toBe(true);
  });

  it.each([
    ["no type", { ...base, type: undefined }],
    ["an old type name", { ...base, type: "story" }],
    ["a tier", { ...base, tier: "fast" }],
    ["21 touches", { ...base, touches: Array(21).fill("a") }],
    ["a blank out-of-scope item", { ...base, outOfScope: [" "] }],
    ["an unknown size", { ...base, size: "XL" }],
    ["eleven gaps", { ...base, gaps: Array(11).fill(gap) }],
    ["a gap too long", { ...base, gaps: [{ ...gap, question: "x".repeat(501) }] }],
    ["a gap with no rating", { ...base, gaps: [{ question: "q", assumption: "a" }] }],
    ["an unknown cost", { ...base, gaps: [{ ...gap, cost: "cheap" }] }],
    ["too many options", { ...base, gaps: [{ ...gap, options: Array(6).fill(gap.options[0]) }] }],
    // AI-73: the question format. A bare label, no context or an option without a consequence fails.
    [
      "a question with no question mark",
      { ...base, gaps: [{ ...gap, question: "AI-6: M1.17: Agent evals v1, q1: who pays" }] },
    ],
    ["a gap with no context", { ...base, gaps: [{ ...gap, context: undefined }] }],
    ["a gap with a blank context", { ...base, gaps: [{ ...gap, context: " " }] }],
    ["an option as a bare label", { ...base, gaps: [{ ...gap, options: ["Firestore"] }] }],
    [
      "an option without a consequence",
      { ...base, gaps: [{ ...gap, options: [{ label: "Firestore", consequence: "" }] }] },
    ],
    ["a gap with no recommendation", { ...base, gaps: [{ ...gap, recommendation: null }] }],
    ["the old suggestedAnswer field", { ...base, gaps: [{ ...gap, suggestedAnswer: "x" }] }],
    ["an unknown field", { ...base, stage: "ready" }],
    ["a summary too long", { ...base, summary: "x".repeat(4001) }],
    ["a send-back with no reason", { ...base, outcome: "send_back" }],
    ["a split with no children", { ...base, outcome: "split", reason: "big" }],
    [
      "six children",
      {
        ...base,
        outcome: "split",
        reason: "big",
        children: Array(6).fill({ title: "t", body: "b" }),
      },
    ],
  ])("GivenAResultWith%s_WhenParsed_ThenItIsRejected", (_, value) => {
    expect(RefineOutput.safeParse(value).success).toBe(false);
  });
});
