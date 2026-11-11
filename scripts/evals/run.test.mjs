import { describe, expect, it } from "vitest";
import { credentialProblem, expectedFailureMet, parseArgs, promptfooConfig } from "./run.mjs";
import { verdict } from "./verdict.mjs";

describe("parseArgs", () => {
  it("GivenNoFlags_WhenParsed_ThenSubscriptionOnTheCommittedSuite", () => {
    expect(parseArgs([])).toMatchObject({
      source: "subscription",
      ref: "HEAD",
      dir: "platform/evals/cases",
      expect: "pass",
    });
  });

  it("GivenAnOverride_WhenParsed_ThenKeptPerAgent", () => {
    const o = parseArgs([
      "--procedure-override",
      "adversarial-review=platform/evals/fixtures/adversarial-review.weakened.md",
    ]);
    expect(o.overrides).toEqual({
      "adversarial-review": "platform/evals/fixtures/adversarial-review.weakened.md",
    });
  });

  it("GivenAnEmptyOverride_WhenParsed_ThenIgnored", () => {
    expect(parseArgs(["--procedure-override", "", "--cases", ""]).overrides).toEqual({});
  });

  it.each([
    [["--source", "openai"], "--source must be one of"],
    [["--procedure-override", "build=x.md"], "unknown agent"],
    [["--procedure-override", "adversarial-review=../../etc/passwd.md"], "plain .md path"],
    [["--dir", "../x"], "--dir must be a plain path"],
    [["--expect", "maybe"], "--expect must be"],
    [["--bogus", "1"], "unknown flag"],
  ])("GivenBadFlags_WhenParsed_ThenThrows %#", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe("credentialProblem", () => {
  it("GivenApiKeyWithoutTheSecret_WhenChecked_ThenSaysAndyCreatesIt", () => {
    expect(credentialProblem("api-key", {})).toContain("AGENT_EVALS_ANTHROPIC_API_KEY");
  });

  it("GivenSubscriptionWithoutTheToken_WhenChecked_ThenNamesTheSecret", () => {
    expect(credentialProblem("subscription", { CLAUDE_CODE_OAUTH_TOKEN: "" })).toContain(
      "CLAUDE_CODE_OAUTH_TOKEN",
    );
  });

  it.each(["stub", "local"])("GivenSource %s_WhenChecked_ThenNoCredentialNeeded", (source) => {
    expect(credentialProblem(source, {})).toBeNull();
  });
});

describe("promptfooConfig", () => {
  it("GivenACase_WhenBuilt_ThenOneTestWithSchemaAndCaseChecksAndNoInlineCode", () => {
    const config = promptfooConfig({
      suite: "s",
      cases: [
        {
          id: "c1",
          agent: "adversarial-review",
          expect: [{ check: "no-finding", severity: ["blocker"] }],
        },
      ],
      prepared: [
        { id: "c1", workspace: "/w/c1", schemaFile: "/w/c1/s.json", schema: '{"type":"object"}' },
      ],
      source: "stub",
      workDir: "/w",
      stubUrl: "http://127.0.0.1:1",
      claudeBin: "claude",
    });
    const [test] = config.tests;
    expect(test.vars).toMatchObject({ caseId: "c1", workspace: "/w/c1", model: "sonnet" });
    expect(test.metadata.expect).toEqual([{ check: "no-finding", severity: ["blocker"] }]);
    expect(test.assert[0]).toEqual({ type: "is-json", value: { type: "object" } });
    expect(test.assert[1].value).toMatch(/^file:\/\/.*scripts\/evals\/promptfoo-assert\.mjs$/);
    expect(config.providers[0].id).toMatch(/claude-provider\.mjs$/);
  });
});

describe("expectedFailureMet", () => {
  const ok = (caseId, inputTokens) => ({
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
    inputTokens: 10,
    failures: ["x"],
  });

  it("GivenEveryCaseFailedByCheckOrTokens_WhenSelfTested_ThenMet", () => {
    const run = { suite: "s", cases: [bad("a"), ok("t", 500)] };
    expect(expectedFailureMet(run, verdict(run, { t: 100 }))).toBe(true);
  });

  it("GivenACasePassedCleanly_WhenSelfTested_ThenNotMet", () => {
    const run = { suite: "s", cases: [bad("a"), ok("t", 100)] };
    expect(expectedFailureMet(run, verdict(run, { t: 100 }))).toBe(false);
  });
});
