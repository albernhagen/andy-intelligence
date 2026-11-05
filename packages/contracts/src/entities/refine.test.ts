import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REFINE_LIMITS, RefineOutput, Size, TicketType } from "./index";

// The schema the executor hands the agent (`--json-schema`). It must stay in step with
// RefineOutput, which the control plane checks the result against.
const schemaText = readFileSync(
  new URL("../../../../platform/procedures/refine.schema.json", import.meta.url),
  "utf8",
);
const schema = JSON.parse(schemaText);
const item = schema.properties.questions.items;

const question = { text: "Which store?", options: ["Firestore"], suggestedAnswer: "Firestore" };
const sizing = {
  type: "feature",
  size: "S",
  sizeReason: "one module",
  outOfScope: ["the UI"],
  touches: ["packages/domain/**"],
};

describe("RefineOutput", () => {
  it("GivenTheAgentSchemaFile_WhenComparedWithTheLimits_ThenTheyMatch", () => {
    expect(schema.properties.summary.maxLength).toBe(REFINE_LIMITS.summary);
    expect(schema.properties.questions.minItems).toBe(REFINE_LIMITS.minQuestions);
    expect(schema.properties.questions.maxItems).toBe(REFINE_LIMITS.maxQuestions);
    expect(item.properties.text.maxLength).toBe(REFINE_LIMITS.text);
    expect(item.properties.options.maxItems).toBe(REFINE_LIMITS.maxOptions);
    expect(item.properties.options.items.maxLength).toBe(REFINE_LIMITS.option);
    expect(item.properties.suggestedAnswer.maxLength).toBe(REFINE_LIMITS.option);
    expect(item.properties.assumptions.maxItems).toBe(REFINE_LIMITS.maxAssumptions);
    expect(item.properties.assumptions.items.maxLength).toBe(REFINE_LIMITS.assumption);
    expect(schema.properties.sizeReason.maxLength).toBe(REFINE_LIMITS.sizeReason);
    expect(schema.properties.size.enum).toEqual(Size.options);
    expect(schema.properties.type.enum).toEqual(TicketType.options);
    for (const list of ["outOfScope", "touches"]) {
      expect(schema.properties[list].maxItems).toBe(REFINE_LIMITS.maxScopeItems);
      expect(schema.properties[list].items.maxLength).toBe(REFINE_LIMITS.scopeItem);
    }
    expect([...schema.required].sort()).toEqual(Object.keys(RefineOutput.shape).sort());
    expect(Object.keys(item.properties).sort()).toEqual(
      ["assumptions", "options", "suggestedAnswer", "text", "urgency"].sort(),
    );
  });

  it("GivenTheAgentSchemaFile_WhenPassedAsAShellArgument_ThenItHasNoSingleQuote", () => {
    // The workflow wraps the compact schema in single quotes inside claude_args.
    expect(schemaText).not.toContain("'");
  });

  it("GivenAValidResult_WhenParsed_ThenDefaultsAreFilledAndTextTrimmed", () => {
    const out = RefineOutput.parse({ summary: " ok ", ...sizing, questions: [question] });
    expect(out.summary).toBe("ok");
    expect(out.questions[0]).toEqual({ ...question, assumptions: [], urgency: "normal" });
  });

  it.each([
    ["no questions", { summary: "s", ...sizing, questions: [] }],
    ["no type", { summary: "s", ...sizing, type: undefined, questions: [question] }],
    ["an old type name", { summary: "s", ...sizing, type: "story", questions: [question] }],
    ["a tier", { summary: "s", ...sizing, tier: "fast", questions: [question] }],
    [
      "21 touches",
      { summary: "s", ...sizing, touches: Array(21).fill("a"), questions: [question] },
    ],
    [
      "a blank out-of-scope item",
      { summary: "s", ...sizing, outOfScope: [" "], questions: [question] },
    ],
    ["an unknown size", { summary: "s", ...sizing, size: "XL", questions: [question] }],
    ["six questions", { summary: "s", ...sizing, questions: Array(6).fill(question) }],
    ["a question too long", { summary: "s", ...sizing, questions: [{ text: "x".repeat(501) }] }],
    ["a blank question", { summary: "s", ...sizing, questions: [{ text: "   " }] }],
    [
      "too many options",
      { summary: "s", ...sizing, questions: [{ text: "q", options: Array(6).fill("o") }] },
    ],
    ["an unknown field", { summary: "s", ...sizing, questions: [question], stage: "ready" }],
    ["a summary too long", { summary: "x".repeat(4001), ...sizing, questions: [question] }],
  ])("GivenAResultWith%s_WhenParsed_ThenItIsRejected", (_, value) => {
    expect(RefineOutput.safeParse(value).success).toBe(false);
  });
});
