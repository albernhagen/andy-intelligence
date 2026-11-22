#!/usr/bin/env node
// Trim issue for files over their context budget on `main` (AI-344, ADR-0138). CI on `main` no
// longer fails for them (`context-budget.mjs --report` only warns); this keeps one open issue
// naming each file, its size and its budget, so a trim follows without blocking anyone. Edited in
// place as the list changes, closed once nothing is over. Budgets are never raised here.
//
// Runs only on pushes to `main`, on `main`'s own code, with the job's GITHUB_TOKEN
// (`issues: write`). Caps (ADR-0028): one issue, at most MAX_ISSUE_PAGES pages of open issues read.
//
// Env: REPO (owner/name), GITHUB_TOKEN. Usage: node scripts/context-budget-issue.mjs [repo-dir].
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, describe, loadBudgets, trackedFiles } from "./context-budget.mjs";

export const MARKER = "<!-- context-budget-trim (AI-344) -->";
export const TITLE = "Context budget: trim files over budget on main";
export const BOT = "github-actions[bot]";
/** Open issues read to find ours (100 per page). */
export const MAX_ISSUE_PAGES = 3;
const API = "https://api.github.com";

/** The issue body for the files over budget. */
export function issueBody(over) {
  return [
    MARKER,
    "These files are over their context budget on `main` (`context-budget.json`, ADR-0046). CI stays green (AI-344); trim each one, don't raise its budget: move detail to an on-demand doc.",
    "",
    "| File | Size |",
    "|---|---|",
    ...over.map((r) => `| \`${r.path}\` | ${describe(r)} |`),
    "",
    "Updated by the `context-budget-trim` job on each push to `main`; closed when nothing is over.",
  ].join("\n");
}

/**
 * What to do with our issue: `create`, `update`, `close` or `none`.
 * @param {{ number: number, body: string } | null} existing our open issue, if any
 */
export function plan(over, existing) {
  if (over.length === 0) return existing ? { action: "close" } : { action: "none" };
  const body = issueBody(over);
  if (!existing) return { action: "create", body };
  return existing.body === body ? { action: "none" } : { action: "update", body };
}

/** A thin GitHub REST client that throws on an unexpected status. */
export function githubClient(token, fetchImpl = globalThis.fetch) {
  return async (method, path, body) => {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path} returned HTTP ${res.status}`);
    return data;
  };
}

/** Our open issue (opened by the Actions bot, body starting with MARKER), or null. */
export async function findIssue(github, repo) {
  for (let page = 1; page <= MAX_ISSUE_PAGES; page++) {
    const issues =
      (await github(
        "GET",
        `/repos/${repo}/issues?state=open&creator=${encodeURIComponent(BOT)}&per_page=100&page=${page}`,
      )) ?? [];
    const mine = issues.find(
      (i) => !i.pull_request && String(i.body ?? "").startsWith(MARKER) && i.user?.login === BOT,
    );
    if (mine) return { number: mine.number, body: mine.body };
    if (issues.length < 100) break;
  }
  return null;
}

/** Creates, updates or closes our issue for `over`; returns what it did. */
export async function sync({ github, repo, over }) {
  const existing = await findIssue(github, repo);
  const step = plan(over, existing);
  if (step.action === "create") {
    const made = await github("POST", `/repos/${repo}/issues`, { title: TITLE, body: step.body });
    return `opened #${made?.number}`;
  }
  if (step.action === "update") {
    await github("PATCH", `/repos/${repo}/issues/${existing.number}`, { body: step.body });
    return `updated #${existing.number}`;
  }
  if (step.action === "close") {
    await github("PATCH", `/repos/${repo}/issues/${existing.number}`, { state: "closed" });
    return `closed #${existing.number}`;
  }
  return "no change";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? ".";
  const { REPO, GITHUB_TOKEN } = process.env;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(REPO ?? "") || !GITHUB_TOKEN) {
    process.stderr.write("context budget issue: REPO (owner/name) and GITHUB_TOKEN are required\n");
    process.exit(2);
  }
  try {
    const results = check(trackedFiles(dir), loadBudgets(dir), (f) =>
      readFileSync(join(dir, f), "utf8"),
    );
    const over = results.filter((r) => r.over);
    const did = await sync({ github: githubClient(GITHUB_TOKEN), repo: REPO, over });
    process.stdout.write(`context budget issue: ${over.length} file(s) over; ${did}\n`);
  } catch (err) {
    process.stdout.write(`::error title=context-budget-trim::${err.message}\n`);
    process.exit(1);
  }
}
