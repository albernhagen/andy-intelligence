import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IDEATE_LIMITS, IdeateOutput, SPEC_PATH } from "./ideate";

// The schema the ideate agent gets; IdeateOutput is the control plane's check.
const schema = JSON.parse(
  readFileSync(
    new URL("../../../../platform/procedures/ideate.schema.json", import.meta.url),
    "utf8",
  ),
);
const p = schema.properties;

const epicResult = {
  summary: "Weekly summary for runs.",
  outcome: "epic" as const,
  epic: {
    title: "Andy sees his week",
    body: "Runs pile up with no overview.",
    acceptanceCriteria: ["WHEN Andy opens the week THE SYSTEM SHALL show totals"],
    slices: [{ title: "Totals", summary: "Sum the week." }],
  },
  spec: { path: "specs/weekly-summary.md", markdown: "## Problem\n\nNo overview." },
  questions: [],
};

const questionResult = {
  summary: "Team accounts contradict a non-goal.",
  outcome: "question" as const,
  epic: null,
  spec: null,
  questions: [
    {
      question:
        "This idea adds team accounts, but the brief rules out multi-user: update the brief or change the idea?",
      context: "Team accounts let friends log runs. The brief's non-goals say Andy only.",
      options: [
        { label: "Update the brief", consequence: "The epic goes ahead." },
        { label: "Drop it", consequence: "Nothing is built." },
      ],
      recommendation: { answer: "Drop it", reason: "Andy only, for now." },
    },
  ],
};

describe("IdeateOutput", () => {
  it("GivenTheAgentSchema_WhenComparedWithTheCheck_ThenTheCapsAndFieldsMatch", () => {
    expect(Object.keys(IdeateOutput.shape).sort()).toEqual([...schema.required].sort());
    expect(p.summary.maxLength).toBe(IDEATE_LIMITS.summary);
    expect(p.epic.properties.title.maxLength).toBe(IDEATE_LIMITS.title);
    expect(p.epic.properties.body.maxLength).toBe(IDEATE_LIMITS.body);
    expect(p.epic.properties.acceptanceCriteria.maxItems).toBe(IDEATE_LIMITS.criteria);
    expect(p.epic.properties.slices.maxItems).toBe(IDEATE_LIMITS.slices);
    expect(new RegExp(p.spec.properties.path.pattern).source).toBe(SPEC_PATH.source);
    expect(p.spec.properties.markdown.maxLength).toBe(IDEATE_LIMITS.specMarkdown);
    expect(p.questions.items.properties.options.minItems).toBe(2);
    expect(p.questions.items.properties.options.maxItems).toBe(IDEATE_LIMITS.options);
  });

  it.each([
    ["an epic", epicResult],
    ["a question", questionResult],
  ])("GivenAValidResultWith%s_WhenParsed_ThenAccepted", (_name, result) => {
    expect(IdeateOutput.safeParse(result).success).toBe(true);
  });

  it.each([
    ["an epic outcome with a question", { ...epicResult, questions: questionResult.questions }],
    ["an epic outcome without a spec", { ...epicResult, spec: null }],
    ["a question outcome with an epic", { ...questionResult, epic: epicResult.epic }],
    ["a question outcome without a question", { ...questionResult, questions: [] }],
    ["a spec outside specs/", { ...epicResult, spec: { path: "../AGENTS.md", markdown: "x" } }],
    [
      "a recommendation that is no option",
      {
        ...questionResult,
        questions: [
          { ...questionResult.questions[0]!, recommendation: { answer: "Maybe", reason: "r" } },
        ],
      },
    ],
  ])("GivenAResultWith%s_WhenParsed_ThenRefused", (_name, result) => {
    expect(IdeateOutput.safeParse(result).success).toBe(false);
  });
});
