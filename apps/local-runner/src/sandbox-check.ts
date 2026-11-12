import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, openSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentArgs, agentEnv, spawnAgent } from "./agent";
import { LOCAL_LIMITS } from "./config";
import { status } from "./git";
import type { Platform } from "./platform";

/**
 * The live sandbox check before every agent (ADR-0071, ADR-0089 "Isolation"): one Bash call
 * through Claude Code's macOS sandbox (Seatbelt), under the build step's profile and sandbox,
 * in the task's own checkout. Like the Actions check it is judged by the runner, not the model:
 * the log must show exactly this command run once through Bash, and the facts it writes must
 * show the nonce (given only through its environment), a write outside the checkout refused, and
 * no credential variable. macOS has no PID namespace, so the refused outside write stands in
 * for the Actions check's PID 1 fact.
 */

export const MARKER = ".executor-sandbox-check";
export const SANDBOX_TMP = "/tmp/agent";

/** Single-quoted where it is used: it expands inside the sandbox. */
export const CHECK_COMMAND = `{ printf "nonce=%s\\n" "$SANDBOX_CHECK_NONCE"; if ( : > "$SANDBOX_CHECK_PROBE" ) 2>/dev/null; then echo "outside=written"; else echo "outside=denied"; fi; env | cut -d= -f1 | sed "s/^/env=/"; } > ${MARKER}`;

export const CHECK_PROMPT = `This is a sandbox check. Don't read any file. Use the Bash tool exactly once to run this exact command, unchanged, and use no other tool. Then reply with its exit code and nothing else. If it fails, don't retry it or try anything else.

${CHECK_COMMAND}`;

/** Extra names that must never reach the sandbox, beyond the platform's list. */
const RUNNER_CREDENTIAL_VARS = ["LOCAL_RUNNER_SECRET", "RUNNER_SECRET", "RUN_TOKEN"];

/** Why the facts don't show a working sandbox; null when they do. */
export function factsProblem(
  text: string | null,
  {
    nonce,
    probeExists,
    credentialVars,
  }: { nonce: string; probeExists: boolean; credentialVars: readonly string[] },
): string | null {
  if (text === null) return "the command wrote no facts file";
  const lines = text.split("\n");
  const value = (key: string) => lines.find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1);
  if (value("nonce") !== nonce) return "the nonce is missing or wrong";
  if (value("outside") !== "denied" || probeExists)
    return "a write outside the checkout was allowed (no sandbox)";
  const names = new Set(lines.filter((l) => l.startsWith("env=")).map((l) => l.slice(4)));
  if (names.size === 0) return "no environment names";
  const leaked = [...credentialVars, ...RUNNER_CREDENTIAL_VARS].filter((n) => names.has(n));
  if (leaked.length > 0) return `credential variables reached the sandbox: ${leaked.join(", ")}`;
  return null;
}

/** Reads a regular file without following a symlink; null when absent or not a file. */
function readNoFollow(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    return readFileSync(fd, "utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export interface SandboxCheckInput {
  platform: Platform;
  claudeCommand: string;
  /** The task's project checkout. */
  worktree: string;
  /** The task's own directory, outside the checkout. */
  runDir: string;
  signal: AbortSignal;
}

/** Null when the sandbox check passed, else the reason. Leaves the checkout as it found it. */
export async function checkSandbox(input: SandboxCheckInput): Promise<string | null> {
  const nonce = randomBytes(16).toString("hex");
  const probe = join(input.runDir, "sandbox-probe");
  const marker = join(input.worktree, MARKER);
  const settingsPath = join(input.runDir, "sandbox-check-settings.json");
  rmSync(probe, { force: true });
  await mkdir(SANDBOX_TMP, { recursive: true, mode: 0o700 });
  await writeFile(
    settingsPath,
    `${JSON.stringify(input.platform.settings("build", input.worktree), null, 2)}\n`,
    { mode: 0o600 },
  );
  const run = await spawnAgent({
    command: input.claudeCommand,
    args: agentArgs({
      model: "haiku",
      maxTurns: 3,
      settingsPath,
      schema: null,
      allowedTools: "Bash",
      disallowedTools: "Read,Glob,Grep,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch",
    }),
    cwd: input.worktree,
    env: agentEnv({
      TMPDIR: SANDBOX_TMP,
      SANDBOX_CHECK_NONCE: nonce,
      SANDBOX_CHECK_PROBE: probe,
    }),
    prompt: CHECK_PROMPT,
    outputPath: join(input.runDir, "sandbox-check.jsonl"),
    timeoutMs: LOCAL_LIMITS.sandboxCheckMinutes * 60_000,
    signal: input.signal,
  });
  const facts = readNoFollow(marker);
  rmSync(marker, { force: true });
  const probeExists = existsSync(probe);
  rmSync(probe, { force: true });
  if (run.stopped) return "the runner stopped the check";
  if (run.timedOut) return "the check timed out";
  const problem =
    input.platform.checkRunProblem(run.messages, CHECK_COMMAND) ??
    factsProblem(facts, { nonce, probeExists, credentialVars: input.platform.credentialVars });
  if (problem) return problem;
  const dirty = await status(input.worktree).catch(() => "(git status failed)");
  if (dirty !== "")
    return `the check left the checkout changed: ${dirty.split("\n").slice(0, 10).join(" ")}`;
  return null;
}
