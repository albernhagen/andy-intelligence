import { describe, expect, it } from "vitest";
import { MARKER, evaluate, parseFindings, sanitize } from "./security-review-gate.mjs";

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
