// Shared helpers for the coordinator tools (AI-149; runbook `coordinating-sessions.md` §7).
// Every command goes through an injectable `run(cmd, args, opts)` so tests can fake gh and git.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";

/** Runs a command; never throws. @returns {{ status: number, stdout: string, stderr: string }} */
export function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: `${r.stderr ?? ""}${r.error ? String(r.error) : ""}`,
  };
}

/** Runs gh and parses its JSON. `ok` lists exit codes that still carry JSON (gh pr checks). */
export function ghJson(run, args, { ok = [0] } = {}) {
  const r = run("gh", args);
  const fail = (why) => new Error(`gh ${args.join(" ")}: ${why}`);
  if (!ok.includes(r.status)) throw fail(r.stderr.trim() || `exit ${r.status}`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw fail(r.stderr.trim() || "output is not JSON");
  }
}

/** Runs gh and returns its non-empty output lines; throws on a non-zero exit. */
export function ghLines(run, args) {
  const r = run("gh", args);
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")}: ${r.stderr.trim() || r.status}`);
  return r.stdout.split("\n").filter((line) => line.trim() !== "");
}

/** Only the workflow's own comments count: anyone can paste a marker into a public PR. */
export const REVIEW_AUTHOR = "github-actions[bot]";
export const REVIEW_ROLES = {
  security: "<!-- security-review -->",
  adversarial: "<!-- adversarial-review -->",
};
/** Severities that keep a PR from merging under ADR-0120 (coordinate.md §7). */
export const BLOCKING = ["blocker", "should-fix", "high", "critical"];

/**
 * Reads one review agent's sticky comment (format: scripts/review-gate.mjs).
 * @returns {{ sha: string|null, onHead: boolean, verdict: string, counts: Record<string, number>|null, blocking: {severity: string, title: string}[] }}
 */
export function parseReview(body, head) {
  const lines = String(body ?? "").split("\n");
  const sha = /<!-- reviewed-sha: ([0-9a-f]{7,40}) -->/.exec(body ?? "")?.[1] ?? null;
  const verdictAt = lines.findIndex((l) => l.startsWith("### "));
  const verdict = verdictAt >= 0 ? lines[verdictAt].slice(4).trim() : "";
  const countsLine = lines.find((l) => /^[a-z-]+ \d+( · [a-z-]+ \d+)*$/.test(l.trim()));
  const counts = countsLine
    ? Object.fromEntries([...countsLine.matchAll(/([a-z-]+) (\d+)/g)].map((m) => [m[1], +m[2]]))
    : null;
  const blocking = lines
    .map((l) => /^\| ([a-z-]+) \| (.*?) \|/.exec(l))
    .filter((m) => m && BLOCKING.includes(m[1]))
    .map((m) => ({ severity: m[1], title: m[2] }));
  return { sha, onHead: Boolean(sha) && sha === head, verdict, counts, blocking };
}

/** Latest comment per review role from the workflow's bot. */
export function latestReviews(comments) {
  const out = {};
  for (const [role, marker] of Object.entries(REVIEW_ROLES)) {
    const mine = comments
      .filter((c) => c.login === REVIEW_AUTHOR && String(c.body).startsWith(marker))
      .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
    out[role] = mine.at(-1)?.body ?? null;
  }
  return out;
}

/** ADR-0120: what Andy keeps, whatever the coordinator classed. These block a tool merge. */
export const ANDY_KEEPS_ADR = "docs/architecture/adr/0120-coordinator-merges-clean-prs.md";
/** ADR-0092: where reviewers and the coordinator look hardest (ADR-0120). Reported, not blocking. */
export const LOOK_HARDEST_ADR = "docs/architecture/adr/0092-high-risk-list.md";
/** ADR-0120's "Needs Andy's hands" names Terraform that needs `terraform apply`: no path given. */
const ANDY_KEEPS_EXTRA = ["infra/"];

/**
 * Path patterns from an ADR's tables, read from the ADR itself so the tools cannot drift from it:
 * every backticked token in a table row that looks like a path or an all-caps file name.
 */
export function highRiskPatterns(adrText) {
  const rows = adrText.split("\n").filter((l) => l.startsWith("| ") && !/^\|[\s-|]+$/.test(l));
  const tokens = rows.flatMap((row) => [...row.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]));
  return [...new Set(tokens.filter((t) => /[/.]/.test(t) || /^[A-Z]{4,}$/.test(t)))];
}

function patternRegex(pattern) {
  const escaped = pattern
    .split("**")
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*");
  // `dir/` and `dir` (no glob, no file extension) match everything under it; a bare file name
  // like `AGENTS.md` matches at any depth.
  if (pattern.endsWith("/")) return new RegExp(`^${escaped}`);
  if (!pattern.includes("/")) return new RegExp(`(^|/)${escaped}$`);
  if (!/[*.]/.test(pattern.split("/").at(-1))) return new RegExp(`^${escaped}(/|$)`);
  return new RegExp(`^${escaped}$`);
}

/** Which of the given ADR patterns the changed files touch. */
export function highRiskTouched(files, patterns) {
  return patterns.filter((p) => files.some((f) => patternRegex(p).test(f)));
}

/** @returns {{ keeps: string[], hardest: string[] }} */
export function readPatterns(root = process.cwd()) {
  const read = (adr) => highRiskPatterns(readFileSync(`${root}/${adr}`, "utf8"));
  return { keeps: [...read(ANDY_KEEPS_ADR), ...ANDY_KEEPS_EXTRA], hardest: read(LOOK_HARDEST_ADR) };
}

/** Waits `ms` milliseconds (injectable so tests don't wait). */
export const sleep = (ms) => wait(ms);
