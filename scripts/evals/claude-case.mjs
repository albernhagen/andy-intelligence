// One eval case through Claude Code (AI-6, ADR-0086): the CLI the review agents and the executor
// run, with the production procedure, schema, model and read-only tools, in a workspace holding
// only the case's inputs. Returns the structured output, first-request tokens and quota reading.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { rateLimits, runUsage, structuredOutput } from "../executor-report.mjs";
import { CASE_TIMEOUT_MS, MAX_BUDGET_USD_PER_CASE, MAX_TURNS_PER_CASE } from "./config.mjs";

const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
/**
 * Settings for every case. Reads outside the case workspace already need a permission nobody
 * grants (`--tools` without `--allowedTools`); the deny rules and the empty HOME are extra layers.
 */
export const CASE_SETTINGS = {
  disableAllHooks: true,
  permissions: { deny: ["Read(//proc/**)", "Read(//sys/**)", "Read(//etc/**)"] },
};

export function claudeArgs({ prompt, model, schema }) {
  return [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    "--max-turns",
    String(MAX_TURNS_PER_CASE),
    "--max-budget-usd",
    String(MAX_BUDGET_USD_PER_CASE),
    "--tools",
    "Read,Glob,Grep",
    "--json-schema",
    schema,
    "--settings",
    JSON.stringify(CASE_SETTINGS),
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
  ];
}

/**
 * The environment for one case: nothing from the runner's env but PATH and locale, and only the
 * credential the source names. `local` keeps the caller's own env and sign-in.
 */
export function claudeEnv({ source, env, home, caseId, stubUrl }) {
  const quiet = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1" };
  if (source === "local") return { ...env, ...quiet };
  const base = {
    PATH: env.PATH ?? "",
    LANG: env.LANG ?? "C.UTF-8",
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    TMPDIR: join(home, "tmp"),
    ...quiet,
  };
  if (source === "subscription")
    return { ...base, CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN };
  if (source === "api-key") return { ...base, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY };
  if (source === "stub") {
    return {
      ...base,
      ANTHROPIC_BASE_URL: stubUrl,
      ANTHROPIC_API_KEY: "stub-not-a-key",
      ANTHROPIC_CUSTOM_HEADERS: `x-eval-case: ${caseId}`,
    };
  }
  throw new Error(`unknown source ${source}`);
}

/**
 * The highest used share (0-100+) of any subscription window, or null without a reading. Same
 * scale and rounding as `parseRateLimits` in packages/domain/src/quota.ts (a test holds the two
 * equal); the scripts can't import the TypeScript domain at run time.
 */
export function quotaUsedPct(limits) {
  if (!limits) return null;
  const windows = {};
  // As in the domain: the top-level fields describe the limiting window; per-window data wins.
  if (["five_hour", "seven_day"].includes(limits.rateLimitType)) {
    windows[limits.rateLimitType] = limits.utilization;
  }
  for (const w of ["five_hour", "seven_day"]) {
    const u = limits.unifiedWindows?.[w]?.utilization;
    if (u !== undefined) windows[w] = u;
  }
  const shares = Object.values(windows).filter((u) => Number.isFinite(u));
  return shares.length ? Math.round(Math.max(...shares) * 1000) / 10 : null;
}

/** What one case's stream-json says. Model text stays inside `output`; nothing else holds it. */
export function readStream(text) {
  const messages = text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const result = messages.findLast((m) => m?.type === "result");
  const first = messages.find((m) => m?.type === "assistant" && m.message?.usage)?.message.usage;
  const firstInputTokens = first
    ? (first.input_tokens ?? 0) +
      (first.cache_creation_input_tokens ?? 0) +
      (first.cache_read_input_tokens ?? 0)
    : null;
  return {
    result,
    output: structuredOutput(result),
    usage: runUsage(result),
    costUsd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null,
    firstInputTokens,
    quotaPct: quotaUsedPct(rateLimits(messages)),
  };
}

/** A fixed reason for a case that produced no usable output. */
export function errorKind({ result, output, exitCode, timedOut }) {
  if (timedOut) return "timed out";
  if (!result) return `no result (Claude Code exit code ${exitCode})`;
  if (result.subtype === "error_max_turns") return "turn cap reached";
  if (result.subtype === "error_max_budget_usd") return "budget cap reached";
  if (result.is_error) return `agent error (${String(result.subtype ?? "unknown").slice(0, 40)})`;
  if (output === null) return "no structured output";
  return null;
}

function runClaude(spawnFn, { bin, args, cwd, env }) {
  return new Promise((resolve) => {
    const child = spawnFn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CASE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += chunk;
    });
    child.stderr.on("data", () => {}); // CLI diagnostics can echo model text: never logged
    child.on("error", () => {});
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, exitCode: code, timedOut });
    });
  });
}

/**
 * Runs one case and returns what it produced: `{ output, errorKind, firstInputTokens, quotaPct }`.
 * `output` is the structured output (model text stays there); `errorKind` is a fixed reason.
 */
export async function runCase(
  { caseId, prompt, workspace, schema, model },
  { source, workDir, stubUrl, claudeBin = "claude", spawnFn = spawn, env = process.env },
) {
  const home = join(workDir, "home", caseId);
  mkdirSync(join(home, "tmp"), { recursive: true });
  const run = await runClaude(spawnFn, {
    bin: claudeBin,
    args: claudeArgs({ prompt, model, schema }),
    cwd: workspace,
    env: claudeEnv({ source, env, home, caseId, stubUrl }),
  });
  const read = readStream(run.stdout);
  return {
    output: read.output,
    errorKind: errorKind({ ...read, ...run }),
    firstInputTokens: read.firstInputTokens,
    quotaPct: read.quotaPct,
  };
}
