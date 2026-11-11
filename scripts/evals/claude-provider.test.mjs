import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout } from "node:timers";
import { describe, expect, it } from "vitest";
import ClaudeCodeProvider, {
  claudeArgs,
  claudeEnv,
  errorKind,
  quotaUsedPct,
  readStream,
} from "./claude-provider.mjs";
import { CLAUDE_SUB_THRESHOLDS, parseRateLimits } from "../../packages/domain/src/quota.ts";
import { MAX_BUDGET_USD_PER_CASE, MAX_TURNS_PER_CASE, QUOTA_RESERVE_PCT } from "./config.mjs";

const output = { summary: "x", findings: [] };
const assistant = {
  type: "assistant",
  message: {
    usage: { input_tokens: 10, cache_creation_input_tokens: 900, cache_read_input_tokens: 90 },
  },
};
const result = {
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 2,
  total_cost_usd: 0.05,
  structured_output: output,
  usage: {
    input_tokens: 20,
    output_tokens: 7,
    cache_read_input_tokens: 5,
    cache_creation_input_tokens: 3,
  },
};
const limits = (u) => ({
  type: "rate_limit_event",
  rate_limit_info: {
    unifiedWindows: { five_hour: { utilization: u }, seven_day: { utilization: 0.1 } },
  },
});
const stream = (...msgs) => msgs.map((m) => JSON.stringify(m)).join("\n");

/** A spawn stand-in that prints `stdout` and exits with `code`, recording what it was given. */
function fakeSpawn(stdout, code = 0) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.end(stdout);
      child.stderr.end("diagnostics");
      setTimeout(() => child.emit("close", code), 5);
    });
    return child;
  };
  return { spawn, calls };
}

function caseVars() {
  const dir = mkdtempSync(join(tmpdir(), "evals-provider-"));
  writeFileSync(join(dir, "schema.json"), '{"type":"object"}');
  return {
    dir,
    vars: { caseId: "c1", workspace: dir, schemaFile: join(dir, "schema.json"), model: "sonnet" },
  };
}

describe("claudeArgs", () => {
  it("GivenACase_WhenBuilt_ThenReadOnlyToolsAndTheCapsAreSet", () => {
    const args = claudeArgs({ prompt: "p", model: "sonnet", schema: "{}" });
    const after = (flag) => args[args.indexOf(flag) + 1];
    expect(after("--tools")).toBe("Read,Glob,Grep");
    expect(after("--max-turns")).toBe(String(MAX_TURNS_PER_CASE));
    expect(after("--max-budget-usd")).toBe(String(MAX_BUDGET_USD_PER_CASE));
    expect(args).not.toContain("--allowedTools");
    expect(JSON.parse(after("--settings")).disableAllHooks).toBe(true);
  });
});

describe("claudeEnv", () => {
  const env = {
    PATH: "/bin",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth",
    ANTHROPIC_API_KEY: "key",
    GITHUB_TOKEN: "gh",
  };

  it("GivenSubscription_WhenBuilt_ThenOnlyTheOauthTokenPasses", () => {
    const e = claudeEnv({ source: "subscription", env, home: "/h" });
    expect(e.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth");
    expect(e).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(e).not.toHaveProperty("GITHUB_TOKEN");
    expect(e.HOME).toBe("/h");
  });

  it("GivenApiKey_WhenBuilt_ThenOnlyTheKeyPasses", () => {
    const e = claudeEnv({ source: "api-key", env, home: "/h" });
    expect(e.ANTHROPIC_API_KEY).toBe("key");
    expect(e).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("GivenStub_WhenBuilt_ThenNoRealCredentialAndTheCaseHeader", () => {
    const e = claudeEnv({
      source: "stub",
      env,
      home: "/h",
      caseId: "c1",
      stubUrl: "http://127.0.0.1:1",
    });
    expect(e.ANTHROPIC_API_KEY).toBe("stub-not-a-key");
    expect(e).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(e.ANTHROPIC_CUSTOM_HEADERS).toBe("x-eval-case: c1");
  });
});

describe("readStream", () => {
  it("GivenAFullRun_WhenRead_ThenFirstRequestTokensOutputAndQuota", () => {
    const read = readStream(
      stream(
        limits(0.42),
        assistant,
        { ...assistant, message: { usage: { input_tokens: 99999 } } },
        result,
      ),
    );
    expect(read.firstInputTokens).toBe(1000);
    expect(read.output).toEqual(output);
    expect(read.quotaPct).toBe(42);
    expect(read.usage.turns).toBe(2);
  });

  it("GivenGarbageLines_WhenRead_ThenIgnored", () => {
    expect(readStream("not json\n").result).toBeUndefined();
  });

  it("GivenTheReserve_WhenCompared_ThenTheDomainPauseLevel", () => {
    expect(QUOTA_RESERVE_PCT).toBe(CLAUDE_SUB_THRESHOLDS.pausePct);
  });

  it("GivenNoReading_WhenQuotaRead_ThenNull", () => {
    expect(quotaUsedPct(null)).toBeNull();
    expect(quotaUsedPct({ utilization: 0.81, rateLimitType: "five_hour" })).toBe(81);
    expect(quotaUsedPct({ utilization: 0.81 })).toBeNull();
  });
});

describe("errorKind", () => {
  it.each([
    [{ timedOut: true }, "timed out"],
    [{ result: undefined, exitCode: 1 }, "no result (Claude Code exit code 1)"],
    [{ result: { subtype: "error_max_turns" } }, "turn cap reached"],
    [{ result: { subtype: "error_max_budget_usd" } }, "budget cap reached"],
    [{ result: { subtype: "success", is_error: false }, output: null }, "no structured output"],
    [{ result: { subtype: "success", is_error: false }, output: {} }, null],
  ])("GivenARun_WhenClassified_ThenFixedReason %#", (run, want) => {
    expect(errorKind(run)).toBe(want);
  });
});

describe("ClaudeCodeProvider", () => {
  it("GivenASuccessfulRun_WhenCalled_ThenOutputAndTokenMetadata", async () => {
    const { dir, vars } = caseVars();
    const { spawn, calls } = fakeSpawn(stream(assistant, result));
    const provider = new ClaudeCodeProvider({ config: { source: "stub", workDir: dir }, spawn });
    const res = await provider.callApi("the prompt", { vars });
    expect(JSON.parse(res.output)).toEqual(output);
    expect(res.metadata).toMatchObject({ caseId: "c1", firstInputTokens: 1000, turns: 2 });
    expect(calls[0].opts.cwd).toBe(dir);
    expect(calls[0].args[1]).toBe("the prompt");
  });

  it("GivenATurnCap_WhenCalled_ThenAFixedErrorKind", async () => {
    const { dir, vars } = caseVars();
    const { spawn } = fakeSpawn(
      stream({ type: "result", subtype: "error_max_turns", is_error: true }),
      1,
    );
    const provider = new ClaudeCodeProvider({ config: { source: "stub", workDir: dir }, spawn });
    expect(await provider.callApi("p", { vars })).toMatchObject({
      error: "turn cap reached",
      metadata: { errorKind: "turn cap reached" },
    });
  });

  it("GivenTheQuotaReachesTheReserve_WhenCalled_ThenLaterCasesSkipWithoutRunning", async () => {
    const { dir, vars } = caseVars();
    const { spawn, calls } = fakeSpawn(stream(limits(0.85), assistant, result));
    const provider = new ClaudeCodeProvider({
      config: { source: "subscription", workDir: dir },
      spawn,
    });
    await provider.callApi("p", { vars });
    const second = await provider.callApi("p", { vars: { ...vars, caseId: "c2" } });
    expect(second).toMatchObject({ metadata: { skipped: "quota" } });
    expect(calls).toHaveLength(1);
  });

  it("GivenTheApiKeySource_WhenTheReadingIsHigh_ThenNoReserveSkip", async () => {
    const { dir, vars } = caseVars();
    const { spawn, calls } = fakeSpawn(stream(limits(0.95), assistant, result));
    const provider = new ClaudeCodeProvider({ config: { source: "api-key", workDir: dir }, spawn });
    await provider.callApi("p", { vars });
    const second = await provider.callApi("p", { vars: { ...vars, caseId: "c2" } });
    expect(second.metadata.skipped).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it("GivenAReadingOnA0To100Scale_WhenCalled_ThenTheCaseErrorsInsteadOfSkipping", async () => {
    const { dir, vars } = caseVars();
    const { spawn } = fakeSpawn(stream(limits(45), assistant, result));
    const provider = new ClaudeCodeProvider({
      config: { source: "subscription", workDir: dir },
      spawn,
    });
    const res = await provider.callApi("p", { vars });
    expect(res.metadata.errorKind).toMatch(/^quota reading out of range/);
    expect(provider.reserveReading).toBeNull();
  });
});

describe("quotaUsedPct matches the domain's quota parser", () => {
  it.each([
    [{ utilization: 0.81, rateLimitType: "five_hour", resetsAt: 1 }],
    [
      {
        unifiedWindows: {
          five_hour: { utilization: 0.123, resetsAt: 1 },
          seven_day: { utilization: 0.456, resetsAt: 1 },
        },
      },
    ],
    [
      {
        unifiedWindows: { five_hour: { utilization: 0.2, resetsAt: 1 } },
        utilization: 0.9,
        rateLimitType: "five_hour",
      },
    ],
  ])("GivenARateLimitInfo_WhenBothRead_ThenTheSameHighestPercent %#", (info) => {
    const parsed = parseRateLimits(info, new Date());
    expect(parsed.ok).toBe(true);
    const domainMax = Math.max(...parsed.readings.map((r) => r.usedPct));
    expect(quotaUsedPct(info)).toBe(domainMax);
  });
});
