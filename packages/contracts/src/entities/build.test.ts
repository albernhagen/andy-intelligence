import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILD_LIMITS, BuildCheck, BuildOutput, BuildPlan } from "./index";

// The schema the executor hands the build agent (`--json-schema`). It must stay in step with
// BuildOutput, which the control plane checks the result against.
const schemaText = readFileSync(
  new URL("../../../../platform/procedures/build.schema.json", import.meta.url),
  "utf8",
);
const schema = JSON.parse(schemaText);
const plan = schema.properties.plan;
const check = schema.properties.verification.items;

const validBuildOutput = {
  summary: "Adds the build dispatcher.",
  plan: {
    files: ["packages/domain/src/build-dispatch.ts"],
    steps: ["Write the dispatcher", "Test it"],
    tests: ["GivenReadyTickets_WhenNext_ThenTopRankStarts"],
    riskiestStep: "Ordering by rank",
    rejectedAlternatives: ["Polling: the system is event-driven"],
  },
  deviations: [],
  verification: [{ command: "pnpm test", passed: true, output: "42 passed" }],
  failingTestFiles: [],
};

describe("BuildOutput", () => {
  it("GivenTheAgentSchemaFile_WhenComparedWithTheLimits_ThenTheyMatch", () => {
    expect(schema.properties.summary.maxLength).toBe(BUILD_LIMITS.summary);
    expect(plan.properties.files.maxItems).toBe(BUILD_LIMITS.maxFiles);
    expect(plan.properties.files.items.maxLength).toBe(BUILD_LIMITS.path);
    expect(plan.properties.steps.maxItems).toBe(BUILD_LIMITS.maxSteps);
    expect(plan.properties.tests.maxItems).toBe(BUILD_LIMITS.maxTests);
    expect(plan.properties.riskiestStep.maxLength).toBe(BUILD_LIMITS.item);
    expect(plan.properties.rejectedAlternatives.maxItems).toBe(BUILD_LIMITS.maxAlternatives);
    expect(schema.properties.deviations.maxItems).toBe(BUILD_LIMITS.maxDeviations);
    expect(schema.properties.verification.minItems).toBe(1);
    expect(schema.properties.verification.maxItems).toBe(BUILD_LIMITS.maxChecks);
    expect(check.properties.command.maxLength).toBe(BUILD_LIMITS.command);
    expect(check.properties.output.maxLength).toBe(BUILD_LIMITS.checkOutput);
    expect(schema.properties.failingTestFiles.items.maxLength).toBe(BUILD_LIMITS.path);
    expect([...schema.required].sort()).toEqual(Object.keys(BuildOutput.shape).sort());
    expect([...plan.required].sort()).toEqual(Object.keys(BuildPlan.shape).sort());
    expect([...check.required].sort()).toEqual(Object.keys(BuildCheck.shape).sort());
  });

  it("GivenTheAgentSchemaFile_WhenPassedAsAShellArgument_ThenItHasNoSingleQuote", () => {
    expect(schemaText).not.toContain("'");
  });

  it("GivenAValidResult_WhenParsed_ThenItIsAccepted", () => {
    expect(BuildOutput.parse(validBuildOutput)).toEqual(validBuildOutput);
  });

  it("GivenNoVerification_WhenParsed_ThenItIsRejected", () => {
    expect(BuildOutput.safeParse({ ...validBuildOutput, verification: [] }).success).toBe(false);
  });

  it("GivenAnUnknownField_WhenParsed_ThenItIsRejected", () => {
    expect(BuildOutput.safeParse({ ...validBuildOutput, merge: true }).success).toBe(false);
  });
});
