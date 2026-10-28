#!/usr/bin/env node
// Security-review scope (ADR-0030): docs-only PRs skip the agent to save subscription quota.
// Agent-facing rule files are never "docs": a PR that edits them still gets reviewed.
// Reads changed paths (one per line) from stdin; prints "true" when the PR is docs-only.
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(String(isDocsOnly(readFileSync(0, "utf8").split("\n"))));
}
