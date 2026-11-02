import { describe, expect, it } from "vitest";
import {
  MARKER,
  ROLES,
  evaluate,
  parseFindings,
  reviewedShaMarker,
  sanitize,
  usageLine,
} from "./review-gate.mjs";

const finding = (severity, extra = {}) => ({
  severity,
  title: `${severity} issue`,
  file: "infra/bootstrap/main.tf",
  line: 105,
  description: "why",
  recommendation: "fix",
  ...extra,
});
const output = (findings, summary = "Reviewed IAM.") => JSON.stringify({ summary, findings });

describe("sanitize", () => {
  it("GivenHtmlMentionsPipesAndNewlines_WhenSanitized_ThenNeutralized", () => {
    expect(sanitize("<img src=x> @andy a|b\nnext")).toBe("&lt;img src=x&gt; @​andy a\\|b next");
  });

  it("GivenBackslashBeforePipe_WhenSanitized_ThenPipeStaysEscaped", () => {
    expect(sanitize("a\\|b")).toBe("a\\\\\\|b");
  });

  it("GivenLongText_WhenSanitized_ThenTruncated", () => {
    expect(sanitize("x".repeat(600))).toHaveLength(501);
  });

  it("GivenNullish_WhenSanitized_ThenEmpty", () => {
    expect(sanitize(undefined)).toBe("");
  });
});

describe("parseFindings", () => {
  it("GivenValidOutput_WhenParsed_ThenReturnsFindings", () => {
    expect(parseFindings(output([finding("high")]))?.findings).toHaveLength(1);
  });

  it("GivenInvalidJsonOrShape_WhenParsed_ThenNull", () => {
    expect(parseFindings("")).toBeNull();
    expect(parseFindings("not json")).toBeNull();
    expect(parseFindings(JSON.stringify({ summary: "x" }))).toBeNull();
  });

  it("GivenUnknownSeverity_WhenParsed_ThenNull", () => {
    expect(parseFindings(output([finding("severe")]))).toBeNull();
  });
});

describe("evaluate", () => {
  const base = { mode: "review", accepted: false, sha: "abc123" };

  it("GivenHighFinding_WhenNotAccepted_ThenFails", () => {
    const result = evaluate({ ...base, findings: output([finding("high"), finding("low")]) });
    expect(result.pass).toBe(false);
    expect(result.body).toContain(MARKER);
    expect(result.body).toContain("1 high/critical");
  });

  it("GivenCriticalFinding_WhenAccepted_ThenPassesWithWarning", () => {
    const result = evaluate({ ...base, accepted: true, findings: output([finding("critical")]) });
    expect(result.pass).toBe(true);
    expect(result.body).toContain("accepted by `security-accepted`");
  });

  it("GivenOnlyMediumAndLow_WhenEvaluated_ThenPasses", () => {
    const result = evaluate({ ...base, findings: output([finding("medium"), finding("low")]) });
    expect(result.pass).toBe(true);
    expect(result.body).toContain("no high/critical");
  });

  it("GivenNoFindings_WhenEvaluated_ThenPassesWithoutTable", () => {
    const result = evaluate({ ...base, findings: output([]) });
    expect(result.pass).toBe(true);
    expect(result.body).not.toContain("| Severity |");
  });

  it("GivenFindings_WhenEvaluated_ThenSortedBySeverity", () => {
    const { body } = evaluate({ ...base, findings: output([finding("low"), finding("critical")]) });
    expect(body.indexOf("critical issue")).toBeLessThan(body.indexOf("low issue"));
  });

  it("GivenAgentOutputMissing_WhenReviewMode_ThenNeutralPass", () => {
    const result = evaluate({ ...base, findings: "" });
    expect(result.pass).toBe(true);
    expect(result.body).toContain("no valid findings");
  });

  it("GivenUnavailable_WhenEvaluated_ThenNeutralPassWithReason", () => {
    const result = evaluate({ mode: "unavailable", accepted: false, reason: "no token", sha: "x" });
    expect(result.pass).toBe(true);
    expect(result.body).toContain("no token");
  });

  it("GivenForkPr_WhenNotAccepted_ThenFails", () => {
    expect(evaluate({ mode: "fork", accepted: false, sha: "x" }).pass).toBe(false);
    expect(evaluate({ mode: "fork", accepted: true, sha: "x" }).pass).toBe(true);
  });

  it("GivenInjectedMarkupInFinding_WhenEvaluated_ThenEscaped", () => {
    const evil = finding("low", { title: "<script>x</script> @someone" });
    const { body } = evaluate({ ...base, findings: output([evil]) });
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("@someone");
  });
});

describe("usageLine", () => {
  const result = {
    type: "result",
    num_turns: 12,
    total_cost_usd: 0.4567,
    usage: { input_tokens: 1000, cache_read_input_tokens: 20000, output_tokens: 1500 },
  };

  it("GivenResultMessage_WhenFormatted_ThenTurnsTokensAndEstimate", () => {
    expect(usageLine([{ type: "system" }, result])).toBe(
      "Usage: 12 turns, 21,000 input / 1,500 output tokens, ≈ $0.46 API-equivalent (estimate; uses subscription quota, not billed).",
    );
  });

  it("GivenNoResultMessage_WhenFormatted_ThenEmpty", () => {
    expect(usageLine([{ type: "assistant" }])).toBe("");
    expect(usageLine(null)).toBe("");
    expect(usageLine([{ type: "result" }])).toBe("");
  });

  it("GivenUsage_WhenEvaluated_ThenShownInFooter", () => {
    const { body } = evaluate({
      mode: "review",
      accepted: false,
      sha: "x",
      findings: JSON.stringify({ summary: "", findings: [] }),
      usage: "Usage: 3 turns.",
    });
    expect(body).toContain("<sub>Usage: 3 turns. Commit x.");
  });
});

describe("evaluate (adversarial)", () => {
  const base = { role: "adversarial", mode: "review", accepted: false, sha: "def456" };
  const adv = (severity, extra = {}) => ({
    severity,
    title: `${severity} finding`,
    file: "src/paging.ts",
    line: 12,
    scenario: "page=2, size=10 → returns items 11–21 (one extra)",
    recommendation: "use < not <=; add a test for the last page",
    ...extra,
  });
  const out = (findings, resolved) =>
    JSON.stringify({ summary: "Reviewed paging.", findings, resolved });

  it("GivenABlocker_WhenNotAccepted_ThenFailsWithScenarioColumn", () => {
    const result = evaluate({ ...base, findings: out([adv("blocker"), adv("question")]) });
    expect(result.pass).toBe(false);
    expect(result.body).toContain(ROLES.adversarial.marker);
    expect(result.body).toContain("1 blocker");
    expect(result.body).toContain("| Failing scenario |");
    expect(result.body).toContain("page=2, size=10");
  });

  it("GivenABlocker_WhenReviewAccepted_ThenPassesWithWarning", () => {
    const result = evaluate({ ...base, accepted: true, findings: out([adv("blocker")]) });
    expect(result.pass).toBe(true);
    expect(result.body).toContain("accepted by `review-accepted`");
  });

  it("GivenOnlyShouldFixAndQuestions_WhenEvaluated_ThenPasses", () => {
    const result = evaluate({ ...base, findings: out([adv("should-fix"), adv("question")]) });
    expect(result.pass).toBe(true);
    expect(result.body).toContain("no blocker findings");
  });

  it("GivenSecuritySeverities_WhenParsedAsAdversarial_ThenNull", () => {
    expect(parseFindings(out([adv("high")]), ROLES.adversarial)).toBeNull();
  });

  it("GivenResolvedItems_WhenEvaluated_ThenListedSanitized", () => {
    const { body } = evaluate({ ...base, findings: out([], ["Off-by-one fixed in abc @x"]) });
    expect(body).toContain("**Resolved since the last review:**");
    expect(body).toContain("- Off-by-one fixed in abc @​x");
  });

  it("GivenACompletedReview_WhenEvaluated_ThenRecordsTheReviewedSha", () => {
    expect(evaluate({ ...base, findings: out([]) }).body).toContain(reviewedShaMarker("def456"));
  });

  it("GivenANeutralOrForkRun_WhenEvaluated_ThenNoReviewedSha", () => {
    expect(evaluate({ ...base, findings: "" }).body).not.toContain("reviewed-sha");
    expect(evaluate({ ...base, mode: "unavailable", reason: "x" }).body).not.toContain(
      "reviewed-sha",
    );
    expect(evaluate({ ...base, mode: "fork" }).body).not.toContain("reviewed-sha");
  });

  it("GivenAnUnknownRole_WhenEvaluated_ThenThrows", () => {
    expect(() => evaluate({ ...base, role: "nope", findings: out([]) })).toThrow();
  });
});
