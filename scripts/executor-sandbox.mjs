#!/usr/bin/env node
// Executor sandbox checks (ADR-0071), run by the build run's `agent` job from the platform
// checkout, never the project's.
//
// Usage: executor-sandbox.mjs verify-check | check-git
//   verify-check (before the agent): env EXECUTION_FILE (the check run's SDK message log),
//     COMMAND (the exact command the check had to run), MARKER (the facts file it writes),
//     NONCE (given to the command only through its environment). Passes only if the log shows
//     that command, unchanged, run once through Bash without error and no other tool, and the
//     facts show the nonce, a non-root uid, a PID 1 that isn't the runner's, and no credential
//     variable. Deletes the marker either way.
//   check-git (after the agent): env PRISTINE (the copy of .git taken before the agent), LIVE
//     (the checkout's .git). Prints the sensitive .git paths that differ, one per line.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readMessages } from "./executor-report.mjs";

/** Content blocks of the SDK messages with the given role (`assistant` or `user`). */
function blocks(messages, role) {
  return messages
    .filter((m) => m && typeof m === "object" && m.type === role)
    .flatMap((m) => (Array.isArray(m.message?.content) ? m.message.content : []))
    .filter((b) => b && typeof b === "object");
}

/** Why the check run didn't prove the sandbox; null when it did. */
export function checkRunProblem(messages, command) {
  if (!Array.isArray(messages)) return "no execution log";
  const uses = blocks(messages, "assistant").filter((b) => b.type === "tool_use");
  const other = uses.find((u) => u.name !== "Bash");
  if (other) return `the check used ${String(other.name)}, not only Bash`;
  if (uses.length !== 1) return `the check made ${uses.length} Bash calls, not 1`;
  const [use] = uses;
  if (use.input?.command !== command) return "the check ran a different command";
  const result = blocks(messages, "user").find(
    (b) => b.type === "tool_result" && b.tool_use_id === use.id,
  );
  if (!result) return "the Bash call has no result";
  if (result.is_error === true) return "the Bash call failed in the sandbox";
  return null;
}

/** Variables that must not reach a sandboxed command (the profile's credential denies). */
export const CREDENTIAL_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
];

/**
 * Why the facts the check command wrote don't show a sandbox; null when they do. The file has
 * `nonce=`, `uid=`, `pid1=` lines and one `env=<NAME>` line per variable. The nonce reaches the
 * command only through its environment (never the prompt), so the model can't write it.
 */
export function factsProblem(text, { nonce, hostPid1 }) {
  if (typeof text !== "string") return "the command wrote no facts file";
  const lines = text.split("\n");
  const value = (key) => lines.find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1);
  if (!nonce || value("nonce") !== nonce) return "the nonce is missing or wrong";
  const uid = value("uid");
  if (uid === undefined || !/^\d+$/.test(uid) || uid === "0") return `uid is ${uid ?? "missing"}`;
  const pid1 = value("pid1");
  if (!pid1) return "PID 1 is missing";
  if (pid1.trim() === String(hostPid1).trim())
    return "PID 1 is the runner's own (no PID namespace)";
  const names = new Set(lines.filter((l) => l.startsWith("env=")).map((l) => l.slice(4)));
  if (names.size === 0) return "no environment names";
  const leaked = CREDENTIAL_VARS.filter((n) => names.has(n));
  if (leaked.length > 0) return `credential variables reached the sandbox: ${leaked.join(", ")}`;
  return null;
}

/**
 * Opens `path` once without following a symlink (or blocking on a FIFO) and reads it through
 * that descriptor, so a swap between a check and the read can't redirect it. Returns
 * `{ stat, data }` (data only for a regular file) or `{ code }` (e.g. ENOENT, ELOOP: a symlink).
 */
function readNoFollow(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    return { code: err.code ?? "EIO" };
  }
  try {
    const stat = fstatSync(fd);
    return { stat, data: stat.isFile() ? readFileSync(fd) : null };
  } finally {
    closeSync(fd);
  }
}

/** verify-check: null when the sandbox check passed, else the reason. Deletes the marker. */
export function verifyCheck({ messages, command, marker, nonce, hostPid1 }) {
  const read = readNoFollow(marker);
  const written = read.data ? read.data.toString("utf8") : null;
  rmSync(marker, { force: true });
  return checkRunProblem(messages, command) ?? factsProblem(written, { nonce, hostPid1 });
}

/**
 * `.git` paths whose change could make git run code or read another repository's config:
 * config and hooks (the sandbox also protects them), commondir/gitdir (switch to another
 * repository's config), config.worktree, info (attributes), alternates, modules and worktrees.
 * Refs, objects, the index and logs are data and may change.
 */
export const GIT_SENSITIVE = [
  "config",
  "config.worktree",
  "commondir",
  "gitdir",
  "hooks",
  "info",
  "modules",
  "worktrees",
  "objects/info/alternates",
  "objects/info/http-alternates",
];

/** A fingerprint of a path (never followed if it is a symlink): "" when absent. */
export function fingerprint(path) {
  const r = readNoFollow(path);
  if (r.code === "ENOENT") return "";
  if (r.code === "ELOOP") {
    try {
      return `link:${readlinkSync(path)}`;
    } catch {
      return "link:?";
    }
  }
  if (r.code) return `unreadable:${r.code}`;
  if (r.stat.isFile()) {
    return `file:${r.stat.mode & 0o777}:${createHash("sha256").update(r.data).digest("hex")}`;
  }
  if (r.stat.isDirectory()) {
    const names = readdirSync(path).sort();
    return `dir:[${names.map((n) => `${n}=${fingerprint(join(path, n))}`).join(",")}]`;
  }
  return "other";
}

/** check-git: the sensitive paths that differ between the pristine and the live `.git`. */
export function gitTampering({ pristine, live }) {
  let top;
  try {
    top = lstatSync(live);
  } catch {
    return [".git"];
  }
  if (!top.isDirectory()) return [".git"];
  return GIT_SENSITIVE.filter((p) => fingerprint(join(pristine, p)) !== fingerprint(join(live, p)));
}

function main() {
  const [command] = process.argv.slice(2);
  const env = process.env;
  if (command === "verify-check") {
    const problem = verifyCheck({
      messages: readMessages(env.EXECUTION_FILE),
      command: env.COMMAND,
      marker: env.MARKER,
      nonce: env.NONCE,
      hostPid1: readFileSync("/proc/1/cmdline", "utf8").replaceAll("\0", " "),
    });
    if (problem) {
      process.stdout.write(`Sandbox check failed: ${problem}.\n`);
      process.exitCode = 1;
    }
  } else if (command === "check-git") {
    for (const p of gitTampering({ pristine: env.PRISTINE, live: env.LIVE })) {
      process.stdout.write(`${p}\n`);
    }
  } else {
    throw new Error("usage: executor-sandbox.mjs verify-check | check-git");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
