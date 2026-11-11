import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluatorContract } from "../../packages/contracts/src/testing/index.ts";
import { PROMPTFOO_VERSION } from "./config.mjs";
import { PromptfooEvaluator, promptfooEnv, toCaseResult } from "./promptfoo-evaluator.mjs";

/** A promptfoo result as the pinned version writes it. */
function pfResult(caseId, outcome) {
  if (outcome === "error") {
    return {
      vars: { caseId },
      success: false,
      error: "no result",
      response: { error: "no result", metadata: { caseId, errorKind: "timed out" } },
    };
  }
  const pass = outcome === "pass";
  return {
    vars: { caseId },
    success: pass,
    response: { output: "{}", metadata: { caseId, firstInputTokens: 1234 } },
    gradingResult: {
      pass,
      componentResults: [
        { pass: true, reason: "Assertion passed", assertion: { type: "is-json" } },
        {
          pass,
          reason: pass ? "all checks passed" : "expected a blocker finding: none",
          assertion: { type: "javascript" },
        },
      ],
    },
  };
}

/** An exec stand-in that answers each config test with the scripted outcome, like promptfoo would. */
function fakePromptfoo(script, calls = []) {
  return async (cmd, args, env) => {
    calls.push({ cmd, args, env });
    const config = JSON.parse(readFileSync(args[args.indexOf("-c") + 1], "utf8"));
    const results = config.tests.map((t) =>
      pfResult(t.vars.caseId, script[t.vars.caseId] ?? "error"),
    );
    writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ results: { results } }));
    return results.every((r) => r.success) ? 0 : 100;
  };
}

const buildConfig = (suite, caseIds) => ({
  description: suite,
  tests: caseIds.map((caseId) => ({ vars: { caseId } })),
});
const workDir = () => mkdtempSync(join(tmpdir(), "evals-pf-"));

evaluatorContract(
  "promptfoo",
  async (script) =>
    new PromptfooEvaluator({ workDir: workDir(), buildConfig, exec: fakePromptfoo(script) }),
);

describe("PromptfooEvaluator", () => {
  it("GivenCases_WhenRun_ThenThePinnedCliRunsOnceSeriallyWithoutCache", async () => {
    const calls = [];
    const e = new PromptfooEvaluator({
      workDir: workDir(),
      buildConfig,
      exec: fakePromptfoo({ a: "pass" }, calls),
    });
    await e.runSuite("s", { caseIds: ["a"], maxCases: 5 });
    expect(calls).toHaveLength(1);
    expect(calls[0].args.slice(0, 3)).toEqual(["-y", `promptfoo@${PROMPTFOO_VERSION}`, "eval"]);
    expect(calls[0].args).toEqual(expect.arrayContaining(["--no-cache", "-j", "1"]));
  });

  it("GivenPromptfooCrashes_WhenRun_ThenRejects", async () => {
    const e = new PromptfooEvaluator({ workDir: workDir(), buildConfig, exec: async () => 1 });
    await expect(e.runSuite("s", { caseIds: ["a"], maxCases: 5 })).rejects.toThrow(
      "promptfoo exited with code 1",
    );
  });
});

describe("promptfooEnv", () => {
  it("GivenTheRunnerEnv_WhenNarrowed_ThenOnlyPathLocaleAndTheCredentialPass", () => {
    const env = promptfooEnv(
      {
        PATH: "/bin",
        LANG: "C.UTF-8",
        CLAUDE_CODE_OAUTH_TOKEN: "tok",
        GITHUB_TOKEN: "gh",
        ACTIONS_RUNTIME_TOKEN: "rt",
        HOME: "/home/runner",
        NODE_OPTIONS: "--require x",
      },
      "/w",
    );
    expect(env).toMatchObject({
      PATH: "/bin",
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      HOME: "/w/promptfoo-home",
    });
    for (const k of [
      "GITHUB_TOKEN",
      "ACTIONS_RUNTIME_TOKEN",
      "NODE_OPTIONS",
      "ANTHROPIC_API_KEY",
    ]) {
      expect(env).not.toHaveProperty(k);
    }
    expect(env.npm_config_ignore_scripts).toBe("true");
    expect(env.PROMPTFOO_DISABLE_TELEMETRY).toBe("1");
  });
});

describe("toCaseResult", () => {
  it("GivenAPassingResult_WhenMapped_ThenRanPassedWithTokens", () => {
    expect(toCaseResult("a", pfResult("a", "pass"))).toEqual({
      caseId: "a",
      status: "ran",
      passed: true,
      inputTokens: 1234,
      failures: [],
    });
  });

  it("GivenAFailedSchema_WhenMapped_ThenAFixedSchemaMessage", () => {
    const r = pfResult("a", "pass");
    r.success = false;
    r.gradingResult.componentResults[0] = {
      pass: false,
      reason: "SECRET model text",
      assertion: { type: "is-json" },
    };
    expect(toCaseResult("a", r).failures).toEqual(["output does not match the agent's schema"]);
  });

  it("GivenAQuotaSkip_WhenMapped_ThenSkipped", () => {
    expect(
      toCaseResult("a", { vars: { caseId: "a" }, response: { metadata: { skipped: "quota" } } }),
    ).toMatchObject({ status: "skipped", passed: false });
  });

  it("GivenAnErrorWithoutOurKind_WhenMapped_ThenAGenericMessageNotTheErrorText", () => {
    expect(
      toCaseResult("a", { vars: { caseId: "a" }, error: "SECRET", response: { error: "SECRET" } })
        .failures,
    ).toEqual(["error: provider error"]);
  });

  it("GivenNoResult_WhenMapped_ThenError", () => {
    expect(toCaseResult("a", undefined)).toMatchObject({
      status: "error",
      failures: ["no result"],
    });
  });
});
