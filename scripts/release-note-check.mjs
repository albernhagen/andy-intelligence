#!/usr/bin/env node
// Release-note check (AI-159, ADR-0121): a PR into the default branch must carry the release-note
// block ("What changed:", "How it works:", optional "Needs you:") within its word caps. The parser
// is the domain's own (`packages/domain/src/release-note.ts`), imported with Node's type
// stripping, so the check and the control plane read the block the same way.
//
// Before and after screenshots (AI-353): a PR that changes a stored screenshot must carry the
// "Before and after" table (`pnpm screenshots:table --write`, `screenshot-table.mjs`) with a row
// per added or changed image, or it fails; a PR that changes the web app's source and no stored
// image gets a warning (not a failure). The validated table is printed to the job summary.
// Public repos only: a private repo's raw URLs don't render, so the rule is skipped there.
//
// Reads the PR from the event file ($GITHUB_EVENT_PATH), never from an interpolated expression:
// the description is untrusted text. Its changed files come from the REST API with the job's
// token. Dependabot PRs and PRs into other branches are skipped. Exits 1 with one line per problem.
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseReleaseNote } from "../packages/domain/src/release-note.ts";
import { isStoredImage, parseTable } from "./screenshot-table.mjs";

/** Authors whose PRs never carry a note (their merges are listed by title, as "no note"). */
export const SKIPPED_AUTHORS = ["dependabot[bot]"];

/** The web app's source folder by default; the action's `ui-src` input overrides it. */
export const DEFAULT_UI_SRC = "apps/web/src";

/** Most files the PR files API returns (30 pages of 100). */
const MAX_FILE_PAGES = 30;

const HOW_TO =
  "Add it: push, then run `pnpm screenshots:table --write` (or paste its output into the description).";

/**
 * The before-and-after rule. `files`: the PR's changed files (`{ path, status }`, the REST API's
 * statuses), or null for a private repo, where the rule doesn't apply.
 * @returns {{ problems: string[], warnings: string[], summary: string | null, note: string | null }}
 */
export function checkScreenshots(event, files, uiSrc = DEFAULT_UI_SRC) {
  const none = { problems: [], warnings: [], summary: null, note: null };
  if (files === null) {
    return { ...none, note: "Before and after: skipped, raw image URLs need a public repo." };
  }
  const pr = event.pull_request;
  const [owner, repo] = String(event.repository?.full_name ?? "").split("/");
  const images = files.filter((f) => isStoredImage(f.path));
  const shown = images.filter((f) => f.status !== "removed").map((f) => f.path);
  if (images.length === 0) {
    const src = `${uiSrc.replace(/\/+$/, "")}/`;
    const touchesUi = files.some((f) => f.path.startsWith(src));
    return touchesUi
      ? {
          ...none,
          warnings: [
            `Before and after (AI-353): this PR changes ${src} but no stored screenshot. If a screen changed, update or add its screenshot.`,
          ],
        }
      : none;
  }
  const table = parseTable(pr.body);
  if (table === null) {
    return {
      ...none,
      problems: [
        `Before and after (AI-353): this PR changes ${images.length} stored screenshot(s) and its description has no "Before and after" table.`,
        HOW_TO,
      ],
    };
  }
  const problems = [];
  const warnings = [];
  const listed = new Map(table.rows.map((r) => [r.path, r]));
  const missing = shown.filter((p) => !listed.get(p)?.after.present);
  if (missing.length > 0) {
    problems.push(
      `Before and after (AI-353): the table has no after image for: ${missing.join(", ")}.`,
      HOW_TO,
    );
  }
  const foreign = table.rows.filter((r) =>
    [r.before, r.after].some((c) => c.present && (c.owner !== owner || c.repo !== repo)),
  );
  if (foreign.length > 0) {
    problems.push(
      `Before and after (AI-353): rows must link this repo's files: ${foreign.map((r) => r.path).join(", ")}.`,
    );
  }
  if (table.invalid.length > 0) {
    warnings.push(`Before and after: ${table.invalid.length} malformed row(s) ignored.`);
  }
  const stale = table.rows.filter((r) => r.after.present && r.after.sha !== pr.head?.sha);
  if (stale.length > 0) {
    warnings.push(
      "Before and after: some after images are from an older commit than the head; rerun `pnpm screenshots:table --write`.",
    );
  }
  return { problems, warnings, summary: summaryOf(table.rows, owner, repo), note: null };
}

/** The job summary: the parsed rows written back out, so only validated URLs render. */
function summaryOf(rows, owner, repo) {
  const ok = rows.filter((r) =>
    [r.before, r.after].every((c) => !c.present || (c.owner === owner && c.repo === repo)),
  );
  const lines = ["## Before and after", "", "| Screen | Before | After |", "| --- | --- | --- |"];
  for (const r of ok) {
    const cell = (c, side, literal) =>
      c.present
        ? `![${side}](https://raw.githubusercontent.com/${owner}/${repo}/${c.sha}/${r.path})`
        : literal;
    lines.push(
      `| \`${r.path}\` | ${cell(r.before, "before", "new")} | ${cell(r.after, "after", "removed")} |`,
    );
  }
  return lines.join("\n");
}

/** Whether the PR gets checked at all (the skips in `check`); no API call for a skipped one. */
export function applies(event) {
  const pr = event?.pull_request;
  if (!pr || SKIPPED_AUTHORS.includes(pr.user?.login)) return false;
  const defaultBranch = event.repository?.default_branch;
  return !defaultBranch || pr.base?.ref === defaultBranch;
}

/**
 * @param files the PR's changed files, null for a private repo; undefined skips the rule
 * @returns {{ ok: boolean, lines: string[], warnings: string[], summary: string | null }}
 */
export function check(event, files, uiSrc = DEFAULT_UI_SRC) {
  const pass = (line) => ({ ok: true, lines: [line], warnings: [], summary: null });
  const pr = event?.pull_request;
  if (!pr) return pass("Not a pull request: nothing to check.");
  if (SKIPPED_AUTHORS.includes(pr.user?.login)) {
    return pass(`Skipped: PRs by ${pr.user.login} carry no release note.`);
  }
  const defaultBranch = event.repository?.default_branch;
  if (defaultBranch && pr.base?.ref !== defaultBranch) {
    return pass(`Skipped: this PR targets ${pr.base?.ref}, not ${defaultBranch}.`);
  }
  const { problems } = parseReleaseNote(pr.body ?? "");
  const shots =
    files === undefined
      ? { problems: [], warnings: [], summary: null, note: null }
      : checkScreenshots(event, files, uiSrc);
  const lines = [];
  if (problems.length === 0) lines.push("Release note: OK.");
  else {
    lines.push(
      "Release note (AI-159): fix the block in the PR description, then edit it to re-run.",
      ...problems.map((p) => `- ${p}`),
      'Format: "What changed:" (≤25 words), "How it works:" (≤45), optional "Needs you:" (≤25).',
    );
  }
  lines.push(...shots.problems);
  return {
    ok: problems.length === 0 && shots.problems.length === 0,
    lines,
    warnings: shots.warnings,
    summary: shots.summary ?? shots.note,
  };
}

/** The PR's changed files from the REST API; null for a private repo. */
export async function prFiles(event, token, fetchFn = globalThis.fetch) {
  if (event.repository?.private !== false) return null;
  const files = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const url = `https://api.github.com/repos/${event.repository.full_name}/pulls/${event.pull_request.number}/files?per_page=100&page=${page}`;
    const accept = { accept: "application/vnd.github+json" };
    let res = await fetchFn(url, {
      headers: token ? { ...accept, authorization: `Bearer ${token}` } : accept,
    });
    // A job token without `pull-requests: read` may be refused; the repo is public, so retry
    // without it (no new workflow permission).
    if (token && (res.status === 401 || res.status === 403)) {
      res = await fetchFn(url, { headers: accept });
    }
    if (!res.ok) throw new Error(`listing the PR's files failed: HTTP ${res.status}`);
    const batch = await res.json();
    for (const f of batch) {
      if (f.status === "renamed") {
        files.push({ path: f.previous_filename, status: "removed" });
        files.push({ path: f.filename, status: "added" });
      } else files.push({ path: f.filename, status: f.status });
    }
    if (batch.length < 100) break;
  }
  return files;
}

async function main() {
  const path = process.env.GITHUB_EVENT_PATH;
  const event = path ? JSON.parse(readFileSync(path, "utf8")) : null;
  const files = applies(event) ? await prFiles(event, process.env.GITHUB_TOKEN) : undefined;
  const { ok, lines, warnings, summary } = check(event, files, process.env.UI_SRC || undefined);
  for (const line of lines) process.stdout.write(`${ok ? "" : "::error::"}${line}\n`);
  for (const w of warnings) process.stdout.write(`::warning::${w}\n`);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath && (summary || warnings.length > 0)) {
    appendFileSync(summaryPath, `${[summary, ...warnings].filter(Boolean).join("\n\n")}\n`);
  }
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stdout.write(`::error::${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
