import { describe, expect, it } from "vitest";
import { summary, verdict } from "./verdict.mjs";

const ok = (caseId, inputTokens = 1000) => ({
  caseId,
  status: "ran",
  passed: true,
  inputTokens,
  failures: [],
});
const bad = (caseId) => ({
  caseId,
  status: "ran",
  passed: false,
  inputTokens: 1000,
  failures: ["expected a blocker finding: none"],
});
const run = (...cases) => ({ suite: "s", cases });

describe("verdict", () => {
  it("GivenEveryCasePasses_WhenJudged_ThenPass", () => {
    expect(verdict(run(ok("a"), ok("b")), { a: 1000 })).toMatchObject({
      outcome: "pass",
      passRate: 1,
    });
  });

  it("GivenOneOfTenFails_WhenJudged_ThenPassAtExactlyTheThreshold", () => {
    const cases = [...Array.from({ length: 9 }, (_, i) => ok(`c${i}`)), bad("x")];
    expect(verdict(run(...cases)).outcome).toBe("pass");
  });

  it("GivenTwoOfTenFail_WhenJudged_ThenFail", () => {
    const cases = [...Array.from({ length: 8 }, (_, i) => ok(`c${i}`)), bad("x"), bad("y")];
    const v = verdict(run(...cases));
    expect(v.outcome).toBe("fail");
    expect(v.reasons[0]).toContain("pass rate 80% is below 90%");
  });

  it("GivenAnErroredCase_WhenJudged_ThenItCountsAsFailed", () => {
    const err = {
      caseId: "e",
      status: "error",
      passed: false,
      inputTokens: null,
      failures: ["error: timed out"],
    };
    expect(verdict(run(ok("a"), err)).outcome).toBe("fail");
  });

  it("GivenTokensAt20PercentOver_WhenJudged_ThenPass", () => {
    expect(verdict(run(ok("a", 1200)), { a: 1000 }).outcome).toBe("pass");
  });

  it("GivenTokensPast20PercentOver_WhenJudged_ThenFailLikeAPassRateDrop", () => {
    const v = verdict(run(ok("a", 1201)), { a: 1000 });
    expect(v.outcome).toBe("fail");
    expect(v.reasons[0]).toContain("a: input tokens 1201 are 20.1% over the baseline 1000");
  });

  it("GivenNoBaseline_WhenJudged_ThenListedNotFailed", () => {
    const v = verdict(run(ok("a", 5000)), {});
    expect(v.outcome).toBe("pass");
    expect(v.missingBaselines).toEqual([
      { caseId: "a", inputTokens: 5000, baseline: null, jump: null },
    ]);
  });

  it("GivenTheQuotaReserveStoppedTheRun_WhenNothingFailed_ThenSkippedNotFailed", () => {
    const skip = {
      caseId: "s",
      status: "skipped",
      passed: false,
      inputTokens: null,
      failures: ["skipped: quota reserve"],
    };
    expect(verdict(run(ok("a"), skip)).outcome).toBe("skipped");
    expect(verdict(run(bad("a"), skip)).outcome).toBe("fail");
  });

  it("GivenNoCases_WhenJudged_ThenPass", () => {
    expect(verdict(run()).outcome).toBe("pass");
  });
});

describe("summary", () => {
  it("GivenAFailedRun_WhenSummarised_ThenTableReasonsAndCaps", () => {
    const r = run(ok("a", 1300), bad("b|c"));
    const text = summary({
      run: r,
      result: verdict(r, { a: 1000 }),
      source: "subscription",
      caps: { maxCases: 10, maxTurns: 15 },
      cases: [{ id: "a", agent: "adversarial-review" }],
    });
    expect(text).toContain("## Agent evals: ❌ fail");
    expect(text).toContain("cases 2 (cap 10) · turns per case ≤ 15");
    expect(text).toContain("| a | adversarial-review | fail (tokens) | 1300 | 1000 (+30%) |");
    expect(text).toContain("b\\|c");
  });
});
