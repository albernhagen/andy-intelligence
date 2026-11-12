import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { LOCAL_LIMITS } from "./config";

/** Tools for read-only steps, repeated as flags on top of the profile (as on Actions). */
export const READ_ONLY_ALLOWED = "Read,Glob,Grep";
export const READ_ONLY_DENIED = "Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch";

export interface AgentArgsInput {
  model: string;
  maxTurns: number;
  /** The executor profile for this step, as a settings file outside the checkout. */
  settingsPath: string;
  /** Compact JSON schema for structured output, or null. */
  schema: string | null;
  /** The tools the agent may use (`--allowedTools`) and must not (`--disallowedTools`). */
  allowedTools: string;
  disallowedTools: string;
}

/**
 * The `claude -p` arguments for one agent (ADR-0089 "Profile"). The profile comes in with
 * `--settings`; `--setting-sources ""` turns the user, project and local settings sources off,
 * so nothing in the checkout's `.claude/` (permissions, hooks, env, MCP) or the runner user's
 * own settings loads; `--strict-mcp-config` with no `--mcp-config` starts no MCP server. Managed
 * settings are not used: on macOS they are machine-wide and would bind Andy's own sessions.
 * The prompt goes on stdin.
 */
export function agentArgs(input: AgentArgsInput): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    input.model,
    "--max-turns",
    String(input.maxTurns),
    "--settings",
    input.settingsPath,
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--permission-mode",
    "default",
    "--allowedTools",
    input.allowedTools,
    "--disallowedTools",
    input.disallowedTools,
    ...(input.schema === null ? [] : ["--json-schema", input.schema]),
  ];
}

/**
 * The agent's environment: a short allowlist, never the runner's own. The runner secret and
 * per-run token live only in the runner's memory, so they can't be here. The Claude login is the
 * runner user's own (Keychain, or CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`); with
 * CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 Claude Code strips credentials from its Bash subprocesses.
 */
export function agentEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ["PATH", "HOME", "USER", "LOGNAME", "LANG", "SHELL", "TERM"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return { ...env, CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1", ...extra };
}

export interface AgentRun {
  exitCode: number | null;
  /** The SDK messages from the stream (one JSON object per line); null when none parsed. */
  messages: unknown[] | null;
  timedOut: boolean;
  /** Stopped by the runner (cancel, lost lease, shutdown). */
  stopped: boolean;
  /** The stream went over the cap and was cut. */
  truncated: boolean;
  /** The last part of stderr, for the runner's log only (never the report). */
  stderrTail: string;
}

export interface SpawnAgentInput {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  prompt: string;
  /** The stream is kept here for inspection. */
  outputPath: string;
  timeoutMs: number;
  signal: AbortSignal;
}

/**
 * Runs the agent in its own process group, so stopping it stops every child: SIGTERM, then
 * SIGKILL after a grace period.
 */
export async function spawnAgent(input: SpawnAgentInput): Promise<AgentRun> {
  const out = createWriteStream(input.outputPath, { mode: 0o600 });
  let bytes = 0;
  let truncated = false;
  let stderrTail = "";
  let timedOut = false;
  let stopped = false;

  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });

  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
    const pid = child.pid;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      return;
    }
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, LOCAL_LIMITS.killGraceMs).unref();
  };
  const onAbort = () => {
    stopped = true;
    kill();
  };
  input.signal.addEventListener("abort", onAbort, { once: true });
  if (input.signal.aborted) onAbort();
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, input.timeoutMs);

  child.stdout.on("data", (chunk: Buffer) => {
    if (truncated) return;
    if (bytes + chunk.length > LOCAL_LIMITS.maxAgentOutputBytes) {
      truncated = true;
      kill();
      return;
    }
    bytes += chunk.length;
    out.write(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(input.prompt);

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("error", (err) => {
      stderrTail = `${stderrTail}\n${err.message}`.slice(-2000);
      resolve(null);
    });
    child.on("close", (code) => resolve(code));
  });
  clearTimeout(timer);
  input.signal.removeEventListener("abort", onAbort);
  await new Promise<void>((resolve) => out.end(resolve));

  return {
    exitCode,
    messages: parseStream(await readFile(input.outputPath, "utf8").catch(() => "")),
    timedOut,
    stopped,
    truncated,
    stderrTail,
  };
}

/** One SDK message per line; lines that aren't JSON objects are skipped. */
export function parseStream(text: string): unknown[] | null {
  const messages: unknown[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const message: unknown = JSON.parse(line);
      if (message && typeof message === "object") messages.push(message);
    } catch {
      // A partial last line (the agent was stopped) or a stray log line.
    }
  }
  return messages.length > 0 ? messages : null;
}
