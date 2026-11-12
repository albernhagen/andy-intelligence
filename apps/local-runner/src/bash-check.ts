import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentArgs, agentEnv, spawnAgent } from "./agent";
import { LOCAL_LIMITS } from "./config";
import { git } from "./git";
import type { Confinement } from "./seatbelt";

/**
 * The live Bash check before a local build agent (ADR-0102, as ADR-0071 on Actions). One Bash
 * call through Claude Code's own sandbox, under the same Seatbelt profile, settings, env and
 * checkout the build agent gets, with a fixed prompt (no ticket text) and a cheap model, capped
 * at 3 turns and 5 minutes (ADR-0028). The command writes facts into the checkout; the runner
 * judges them, never the model:
 *
 * - the nonce, which reaches the command only through its environment, so the command ran;
 * - a file in the runner's work directory can't be read (the runner's Seatbelt holds);
 * - HTTPS to a host off the registry allowlist fails (Claude Code's sandbox proxy holds).
 *
 * The stream must show exactly one tool call, Bash with that exact command. Anything else, a
 * refused Bash (the sandbox couldn't start inside Seatbelt: `failIfUnavailable`) included, fails
 * the task before the agent: never unsandboxed Bash, never open network.
 */

/** The fact file, removed again before the agent starts. */
export const BASH_CHECK_FILE = ".executor-sandbox-check";

/** Fixed, single-quoted text: it expands inside the sandbox. */
export const BASH_CHECK_COMMAND = [
  `printf 'nonce=%s\\n' "$SANDBOX_CHECK_NONCE" > ${BASH_CHECK_FILE}`,
  `if /bin/cat "$SANDBOX_CHECK_CANARY" > /dev/null 2>&1; then echo canary=read; else echo canary=denied; fi >> ${BASH_CHECK_FILE}`,
  `if /usr/bin/curl -s -m 5 -o /dev/null https://example.com; then echo net=open; else echo net=blocked; fi >> ${BASH_CHECK_FILE}`,
].join("; ");

export const BASH_CHECK_PROMPT = `This is a sandbox check. Don't read any file. Use the Bash tool exactly once to run this exact command, unchanged, and use no other tool. Then reply with its exit code and nothing else. If it fails, don't retry it or try anything else.

${BASH_CHECK_COMMAND}`;

export interface BashCheckInput {
  claudeCommand: string;
  confinement: Confinement;
  /** The build agent's own Seatbelt profile and settings file. */
  profilePath: string;
  settingsPath: string;
  checkout: string;
  /** The task's work directory (holds the canary; the agent can't read it). */
  runDir: string;
  /** The checkout's git directory, read before any agent ran. */
  gitDir: string;
  signal: AbortSignal;
  model?: string;
  extraEnv?: Record<string, string>;
}

/** The Bash tool calls in an agent's stream, with their commands. */
export function toolCalls(messages: unknown[] | null): { name: string; command: unknown }[] {
  const calls: { name: string; command: unknown }[] = [];
  for (const m of messages ?? []) {
    const message = (m as { type?: unknown; message?: { content?: unknown } }).message;
    if ((m as { type?: unknown }).type !== "assistant" || !Array.isArray(message?.content))
      continue;
    for (const block of message.content as { type?: unknown; name?: unknown; input?: unknown }[]) {
      if (block?.type !== "tool_use") continue;
      calls.push({
        name: String(block.name),
        command: (block.input as { command?: unknown } | undefined)?.command,
      });
    }
  }
  return calls;
}

/** Reads the facts the command wrote, as `key=value` lines. */
export function parseFacts(text: string): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) facts[line.slice(0, at)] = line.slice(at + 1).trim();
  }
  return facts;
}

/** Null when Bash ran once, sandboxed, with the facts above; else why not. */
export async function checkBash(input: BashCheckInput): Promise<string | null> {
  const nonce = randomBytes(16).toString("hex");
  const canary = join(input.runDir, `bash-canary-${randomBytes(6).toString("hex")}`);
  const facts = join(input.checkout, BASH_CHECK_FILE);
  const gitEnv = { GIT_DIR: input.gitDir, GIT_WORK_TREE: input.checkout };
  const status = () =>
    git(["status", "--porcelain", "--untracked-files=all"], input.checkout, gitEnv);
  await writeFile(canary, randomBytes(12).toString("hex"), { mode: 0o600 });
  try {
    const before = await status();
    const run = await spawnAgent({
      ...input.confinement.wrap(
        input.profilePath,
        input.claudeCommand,
        agentArgs({
          model: input.model ?? "haiku",
          maxTurns: 3,
          settingsPath: input.settingsPath,
          schema: null,
        }),
      ),
      cwd: input.checkout,
      env: agentEnv({
        ...input.extraEnv,
        SANDBOX_CHECK_NONCE: nonce,
        SANDBOX_CHECK_CANARY: canary,
      }),
      prompt: BASH_CHECK_PROMPT,
      outputPath: join(input.runDir, "bash-check.jsonl"),
      timeoutMs: LOCAL_LIMITS.sandboxCheckMinutes * 60_000,
      signal: input.signal,
      pidFile: join(input.runDir, "agent.pid"),
    });
    let text = "";
    try {
      text = await readFile(facts, "utf8");
    } catch {
      text = "";
    }
    await rm(facts, { force: true });
    if (run.stopped) return "the check was stopped";
    const calls = toolCalls(run.messages);
    if (calls.length !== 1 || calls[0]!.name !== "Bash" || calls[0]!.command !== BASH_CHECK_COMMAND)
      return "the check didn't make exactly one Bash call with the check command";
    const found = parseFacts(text);
    if (found.nonce !== nonce)
      return "the check command didn't run in Bash (Claude Code's sandbox may not start inside the runner's Seatbelt)";
    if (found.canary !== "denied") return "Bash could read a file in the runner's work directory";
    if (found.net !== "blocked") return "Bash reached a host off the registry allowlist";
    if ((await status()) !== before) return "the check left the checkout changed";
    return null;
  } finally {
    await rm(canary, { force: true });
  }
}
