import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, ProjectPlanDecision, ProjectPlanProposal } from "./project-plan";

// The schema the plan-project agent gets; ProjectPlanProposal is the control plane's check.
const schema = JSON.parse(
  readFileSync(
    new URL("../../../../platform/procedures/plan-project.schema.json", import.meta.url),
    "utf8",
  ),
);
const milestone = schema.properties.milestones.items;

const valid = {
  summary: "Two milestones.",
  milestones: [
    {
      title: "Walking skeleton",
      goal: "Andy can log in.",
      doneWhen: ["URL loads"],
      slices: ["Repo"],
    },
  ],
};

describe("ProjectPlanProposal", () => {
  it("GivenTheAgentSchema_WhenComparedWithTheCheck_ThenTheCapsAndFieldsMatch", () => {
    expect(schema.properties.summary.maxLength).toBe(PLAN_LIMITS.summary);
    expect(schema.properties.milestones.maxItems).toBe(PLAN_LIMITS.milestones);
    expect(milestone.properties.title.maxLength).toBe(PLAN_LIMITS.title);
    expect(milestone.properties.goal.maxLength).toBe(PLAN_LIMITS.goal);
    expect(milestone.properties.doneWhen.maxItems).toBe(PLAN_LIMITS.doneWhen);
    expect(milestone.properties.slices.maxItems).toBe(PLAN_LIMITS.slices);
    expect(milestone.properties.doneWhen.items.maxLength).toBe(PLAN_LIMITS.item);
    expect(milestone.properties.slices.items.maxLength).toBe(PLAN_LIMITS.item);
    expect(Object.keys(ProjectPlanProposal.shape).sort()).toEqual([...schema.required].sort());
    expect(Object.keys(ProjectPlanProposal.shape.milestones.element.shape).sort()).toEqual(
      [...milestone.required].sort(),
    );
  });

  it("GivenAValidResult_WhenParsed_ThenAccepted", () => {
    expect(ProjectPlanProposal.parse(valid)).toEqual(valid);
  });

  it.each([
    ["no milestones", { ...valid, milestones: [] }],
    ["an extra field", { ...valid, tickets: [] }],
    [
      "a title over its cap",
      { ...valid, milestones: [{ ...valid.milestones[0], title: "x".repeat(61) }] },
    ],
    ["no Done when", { ...valid, milestones: [{ ...valid.milestones[0], doneWhen: [] }] }],
  ])("GivenAResultWith%s_WhenParsed_ThenRefused", (_name, input) => {
    expect(ProjectPlanProposal.safeParse(input).success).toBe(false);
  });
});

describe("ProjectPlanDecision", () => {
  it("GivenARejectionWithoutAReason_WhenParsed_ThenRefused", () => {
    expect(ProjectPlanDecision.safeParse({ decision: "rejected" }).success).toBe(false);
    expect(ProjectPlanDecision.safeParse({ decision: "rejected", reason: " " }).success).toBe(
      false,
    );
    expect(ProjectPlanDecision.safeParse({ decision: "approved" }).success).toBe(true);
  });
});
