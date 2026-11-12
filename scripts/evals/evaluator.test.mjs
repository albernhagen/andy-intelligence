import { describe, expect, it } from "vitest";
import { evaluatorContract } from "../../packages/contracts/src/testing/index.ts";
import { ClaudeCodeEvaluator, toCaseResult } from "./evaluator.mjs";

const schema = {
  type: "object",
  properties: { findings: { type: "array", items: { type: "object" } } },
  required: ["findings"],
};
const blocker = { findings: [{ severity: "blocker", title: "t" }] };
const spec = (id) => ({
  id,
  prompt: "p",
  model: "sonnet",
  workspace: `/w/${id}`,
  schema,
  expect: [{ check: "finding", severity: ["blocker"] }],
});
const ran = (output, extra = {}) => ({ output, errorKind: null, firstInputTokens: 1234, ...extra });

/** A runCase stand-in answering each case with its scripted outcome, recording the calls. */
function fakeRunCase(script, calls = [], extra = {}) {
  return async (s) => {
    calls.push(s.id);
    const outcome = script[s.id] ?? "error";
    if (outcome === "error")
      return { output: null, errorKind: "timed out", firstInputTokens: null };
    return ran(outcome === "pass" ? blocker : { findings: [] }, extra[s.id]);
  };
}

const make = (script, { source = "stub", calls, extra } = {}) =>
  new ClaudeCodeEvaluator({
    specs: Object.keys(script).map(spec),
    runCase: fakeRunCase(script, calls, extra),
    source,
  });

evaluatorContract("claude-code", async (script) => make(script));

describe("ClaudeCodeEvaluator", () => {
  it("GivenCases_WhenRun_ThenEachRunsOnceInOrder", async () => {
    const calls = [];
    await make({ b: "pass", a: "fail" }, { calls }).runSuite("s", {
      caseIds: ["b", "a"],
      maxCases: 5,
    });
    expect(calls).toEqual(["b", "a"]);
  });

  it("GivenTheQuotaReachesTheReserve_WhenRun_ThenLaterCasesSkipWithoutRunning", async () => {
    const calls = [];
    const run = await make(
      { a: "pass", b: "pass" },
      { source: "subscription", calls, extra: { a: { quotaPct: 85 } } },
    ).runSuite("s", { caseIds: ["a", "b"], maxCases: 5 });
    expect(calls).toEqual(["a"]);
    expect(run.cases[1]).toMatchObject({ caseId: "b", status: "skipped", passed: false });
    expect(run.quotaPct).toBe(85);
  });

  it("GivenTheApiKeySource_WhenTheReadingIsHigh_ThenNoSkipAndNoQuotaReported", async () => {
    const calls = [];
    const run = await make(
      { a: "pass", b: "pass" },
      { source: "api-key", calls, extra: { a: { quotaPct: 95 } } },
    ).runSuite("s", { caseIds: ["a", "b"], maxCases: 5 });
    expect(calls).toEqual(["a", "b"]);
    expect(run).not.toHaveProperty("quotaPct");
  });

  it("GivenAReadingOnA0To100Scale_WhenRun_ThenTheCaseErrorsInsteadOfSkipping", async () => {
    const calls = [];
    const run = await make(
      { a: "pass", b: "pass" },
      { source: "subscription", calls, extra: { a: { quotaPct: 4500 } } },
    ).runSuite("s", { caseIds: ["a", "b"], maxCases: 5 });
    expect(run.cases[0].failures[0]).toMatch(/^error: quota reading out of range/);
    expect(calls).toEqual(["a", "b"]);
  });

  it("GivenASubscriptionRunWithNoReading_WhenRun_ThenQuotaIsNull", async () => {
    const run = await make({ a: "pass" }, { source: "subscription" }).runSuite("s", {
      caseIds: ["a"],
      maxCases: 5,
    });
    expect(run.quotaPct).toBeNull();
  });
});

describe("toCaseResult", () => {
  it("GivenAPassingOutput_WhenMapped_ThenRanPassedWithTokens", () => {
    expect(toCaseResult(spec("a"), ran(blocker))).toEqual({
      caseId: "a",
      status: "ran",
      passed: true,
      inputTokens: 1234,
      failures: [],
    });
  });

  it("GivenOutputOffSchema_WhenMapped_ThenAFixedSchemaMessageNotTheText", () => {
    const r = toCaseResult(spec("a"), ran({ findings: "SECRET model text" }));
    expect(r.failures).toEqual(["output does not match the agent's schema"]);
  });

  it("GivenAFailedCheck_WhenMapped_ThenTheCheckMessage", () => {
    expect(toCaseResult(spec("a"), ran({ findings: [] })).failures).toEqual([
      "expected a blocker finding: none",
    ]);
  });

  it("GivenAnError_WhenMapped_ThenErrorWithItsFixedKind", () => {
    expect(
      toCaseResult(spec("a"), { output: null, errorKind: "turn cap reached", firstInputTokens: 9 }),
    ).toMatchObject({ status: "error", inputTokens: 9, failures: ["error: turn cap reached"] });
  });
});
