import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GapConfidence, GapCost, REFINE_LIMITS, RefineOutput, Size, TicketType } from "./index";

// The schema the executor hands the agent (`--json-schema`). It must stay in step with
// RefineOutput, which the control plane checks the result against.
const schemaText = readFileSync(
  new URL("../../../../platform/procedures/refine.schema.json", import.meta.url),
  "utf8",
);
const schema = JSON.parse(schemaText);
const item = schema.properties.gaps.items;

const gap = {
  question: "Which store?",
  assumption: "Firestore",
  options: ["Firestore"],
  suggestedAnswer: "Firestore",
  cost: "reversible",
  confidence: "sure",
};
const base = {
  summary: "s",
  type: "feature",
  size: "S",
  sizeReason: "one module",
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
    expect(item.properties.options.items.maxLength).toBe(REFINE_LIMITS.option);
    expect(item.properties.suggestedAnswer.maxLength).toBe(REFINE_LIMITS.option);
    expect(schema.properties.sizeReason.maxLength).toBe(REFINE_LIMITS.sizeReason);
    expect(schema.properties.size.enum).toEqual(Size.options);
    expect(schema.properties.type.enum).toEqual(TicketType.options);
    for (const list of ["outOfScope", "touches"]) {
      expect(schema.properties[list].maxItems).toBe(REFINE_LIMITS.maxScopeItems);
      expect(schema.properties[list].items.maxLength).toBe(REFINE_LIMITS.scopeItem);
    }
    expect([...schema.required].sort()).toEqual(Object.keys(RefineOutput.shape).sort());
    expect(Object.keys(item.properties).sort()).toEqual(
      [
        "assumption",
        "confidence",
        "cost",
        "options",
        "question",
        "suggestedAnswer",
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
    ["too many options", { ...base, gaps: [{ ...gap, options: Array(6).fill("o") }] }],
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
