#!/usr/bin/env node
// Review scope (ADR-0030, ADR-0037): docs-only PRs skip the review agents to save subscription quota.
// Agent-facing rule files are never "docs": a PR that edits them still gets reviewed.
// The same rule lets UI screenshots skip a docs-only PR (AI-358).
//
// Default CLI: reads changed paths (one per line) from stdin; prints "true" when the PR is docs-only.
// `--gate <base-ref>`: diffs <base-ref> against HEAD itself and prints `run=true` or `run=false`
// for $GITHUB_OUTPUT. Any failure to read the change (bad ref, no git, empty diff) prints
// `run=true`, so the check runs its full work.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOCS = [/^docs\//, /^[^/]+\.md$/, /^(apps|packages)\/[^/]+\/README\.md$/];
const AGENT_RULES = new Set(["AGENTS.md", "CLAUDE.md", "docs/BUILD-PROMPT.md"]);

/** True when every changed path is documentation an agent doesn't take rules from. */
export function isDocsOnly(paths) {
  const files = paths.map((p) => p.trim()).filter((p) => p !== "");
  if (files.length === 0) return false;
  return files.every((f) => !AGENT_RULES.has(f) && DOCS.some((pattern) => pattern.test(f)));
}

/** `run=false` only when `listPaths()` succeeds and the change is docs-only; fails safe to `run=true`. */
export function gateOutput(listPaths) {
  try {
    return `run=${!isDocsOnly(listPaths())}`;
  } catch {
    return "run=true";
  }
}

/** Changed paths between `baseRef` and HEAD in the current git checkout; throws if git can't say. */
export function changedPaths(baseRef) {
  if (!baseRef) throw new Error("no base ref");
  return execFileSync("git", ["diff", "--name-only", "--no-renames", baseRef, "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"], // git's error reaches the job log
  }).split("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const gate = process.argv.indexOf("--gate");
  if (gate !== -1) {
    process.stdout.write(`${gateOutput(() => changedPaths(process.argv[gate + 1]))}\n`);
  } else {
    process.stdout.write(String(isDocsOnly(readFileSync(0, "utf8").split("\n"))));
  }
}
