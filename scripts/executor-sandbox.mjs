#!/usr/bin/env node
// Executor sandbox checks (ADR-0071), run by the build run's `agent` job from the platform
// checkout, never the project's.
//
// Usage: executor-sandbox.mjs verify-check | check-git
//   verify-check (before the agent): env EXECUTION_FILE (the check run's SDK message log),
//     COMMAND (the exact command the check had to run), MARKER (file it writes), NONCE. Passes
//     only if the log shows that command, unchanged, run once through Bash without error, no
//     other tool, and the marker holds the nonce. Deletes the marker either way.
//   check-git (after the agent): env PRISTINE (the copy of .git taken before the agent), LIVE
//     (the checkout's .git). Prints the sensitive .git paths that differ, one per line.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
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

/** verify-check: null when the sandbox check passed, else the reason. Deletes the marker. */
export function verifyCheck({ messages, command, marker, nonce }) {
  let written = null;
  try {
    if (lstatSync(marker).isFile()) written = readFileSync(marker, "utf8");
  } catch {
    written = null;
  }
  rmSync(marker, { force: true });
  const problem = checkRunProblem(messages, command);
  if (problem) return problem;
  if (written !== nonce) return "the command's marker file is missing or wrong";
  return null;
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
  let s;
  try {
    s = lstatSync(path);
  } catch {
    return "";
  }
  if (s.isSymbolicLink()) return `link:${readlinkSync(path)}`;
  if (s.isFile()) {
    return `file:${s.mode & 0o777}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  }
  if (s.isDirectory()) {
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
