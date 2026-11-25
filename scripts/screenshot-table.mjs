#!/usr/bin/env node
// Before-and-after table for UI PRs (AI-353). `pnpm screenshots:table` lists every stored
// screenshot the branch changes against its base and prints a Markdown table: one row per image,
// the base commit's raw file beside the head commit's. URLs are pinned to commit SHAs, so the
// table stays true after the branch is deleted. `--write` puts the table into the PR description
// (between the markers below) with `gh`; `--base <branch>` picks the base (default: the PR's).
//
// The release-note check (`release-note-check.mjs`) parses the same table out of the PR
// description, which is untrusted text: `parseTable` accepts only rows of the exact shape
// `formatRow` writes, and nothing from it reaches a shell.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const START = "<!-- before-after:start -->";
export const END = "<!-- before-after:end -->";
const HEADING = "## Before and after";

/** A stored screenshot: a PNG inside a Playwright `__screenshots__` folder. */
export function isStoredImage(path) {
  return /(^|\/)__screenshots__\/.+\.png$/.test(path);
}

/** A path safe to print and to put in a URL: no `..`, no spaces, pipes or control characters. */
export const SAFE_PATH = /^(?!.*\.\.)[A-Za-z0-9._/-]+\.png$/;
const SHA = /^[0-9a-f]{40}$/;
const OWNER = /^[A-Za-z0-9-]+$/;
const REPO = /^[A-Za-z0-9._-]+$/;

/** The raw file URL of `path` at commit `sha`. */
export function rawUrl({ owner, repo }, sha, path) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`;
}

/**
 * Rows for the changed stored images. `files`: `{ path, status }` with status `added`,
 * `modified` or `removed` (a rename is a removal plus an addition). Sorted by path.
 */
export function rowsFor(files) {
  return files
    .filter((f) => isStoredImage(f.path) && SAFE_PATH.test(f.path))
    .filter((f) => ["added", "modified", "removed"].includes(f.status))
    .map((f) => ({ path: f.path, status: f.status }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function formatRow(repo, baseSha, headSha, { path, status }) {
  const before = status === "added" ? "new" : `![before](${rawUrl(repo, baseSha, path)})`;
  const after = status === "removed" ? "removed" : `![after](${rawUrl(repo, headSha, path)})`;
  return `| \`${path}\` | ${before} | ${after} |`;
}

/** The table section (markers included), or null when no stored image changed. */
export function buildTable({ owner, repo, baseSha, headSha, files }) {
  if (!OWNER.test(owner) || !REPO.test(repo)) throw new Error(`bad repo: ${owner}/${repo}`);
  if (!SHA.test(baseSha) || !SHA.test(headSha)) throw new Error("base and head must be full SHAs");
  const rows = rowsFor(files);
  if (rows.length === 0) return null;
  return [
    START,
    HEADING,
    "",
    "| Screen | Before | After |",
    "| --- | --- | --- |",
    ...rows.map((r) => formatRow({ owner, repo }, baseSha, headSha, r)),
    END,
  ].join("\n");
}

const CELL_URL =
  /^!\[(before|after)\]\(https:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/([0-9a-f]{40})\/([A-Za-z0-9._/-]+\.png)\)$/;
const ROW = /^\| `([^`|]+)` \| ([^|]+) \| ([^|]+) \|$/;

function parseCell(cell, side, path) {
  const literal = side === "before" ? "new" : "removed";
  if (cell === literal) return { present: false };
  const m = CELL_URL.exec(cell);
  if (!m || m[1] !== side || m[5] !== path) return null;
  return { present: true, owner: m[2], repo: m[3], sha: m[4] };
}

/**
 * The rows of the table in a PR description, or null when there is no table. Only exact rows
 * count: a row whose path or URLs don't match the shape `buildTable` writes is reported in
 * `invalid` and never used.
 */
export function parseTable(body) {
  const text = String(body ?? "");
  const start = text.indexOf(START);
  const end = text.indexOf(END, start + START.length);
  if (start === -1 || end === -1) return null;
  const rows = [];
  const invalid = [];
  for (const raw of text.slice(start + START.length, end).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("| `")) continue;
    const m = ROW.exec(line);
    const path = m?.[1];
    if (!m || !path || !SAFE_PATH.test(path) || !isStoredImage(path)) {
      invalid.push(line.slice(0, 120));
      continue;
    }
    const before = parseCell(m[2].trim(), "before", path);
    const after = parseCell(m[3].trim(), "after", path);
    if (!before || !after || (!before.present && !after.present)) {
      invalid.push(line.slice(0, 120));
      continue;
    }
    rows.push({ path, before, after });
  }
  return { rows, invalid };
}

/** `body` with its table replaced by `table` (appended when absent; removed when null). */
export function replaceSection(body, table) {
  const text = String(body ?? "");
  const start = text.indexOf(START);
  const end = text.indexOf(END, start + START.length);
  if (start !== -1 && end !== -1) {
    const before = text.slice(0, start).replace(/\s+$/, "");
    const after = text.slice(end + END.length).replace(/^\s+/, "");
    return [before, table, after].filter(Boolean).join("\n\n");
  }
  return table ? `${text.replace(/\s+$/, "")}\n\n${table}` : text;
}

/** `owner/repo` from a GitHub remote URL (https or ssh). */
export function repoOfRemote(url) {
  const m = /github\.com[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!m) throw new Error(`not a GitHub remote: ${url}`);
  return { owner: m[1], repo: m[2] };
}

/** `git diff --name-status` output as `{ path, status }`; renames become removed + added. */
export function filesOfNameStatus(out) {
  const files = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [code, a, b] = line.split("\t");
    if (code?.startsWith("R") || code?.startsWith("C")) {
      if (code.startsWith("R")) files.push({ path: a, status: "removed" });
      files.push({ path: b, status: "added" });
    } else if (code === "A") files.push({ path: a, status: "added" });
    else if (code === "D") files.push({ path: a, status: "removed" });
    else files.push({ path: a, status: "modified" });
  }
  return files;
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gh = (args, input) =>
  execFileSync("gh", args, { encoding: "utf8", ...(input === undefined ? {} : { input }) }).trim();

function baseBranch(argv) {
  const i = argv.indexOf("--base");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  try {
    return gh(["pr", "view", "--json", "baseRefName", "-q", ".baseRefName"]);
  } catch {
    return "main";
  }
}

function main(argv) {
  const base = baseBranch(argv);
  const repo = repoOfRemote(git("remote", "get-url", "origin"));
  const headSha = git("rev-parse", "HEAD");
  const baseSha = git("merge-base", "HEAD", `origin/${base}`);
  const files = filesOfNameStatus(git("diff", "--name-status", "-M", baseSha, headSha));
  const table = buildTable({ ...repo, baseSha, headSha, files });
  if (git("branch", "-r", "--contains", headSha) === "") {
    process.stderr.write("Push first: the after images are raw files of a commit on GitHub.\n");
  }
  process.stdout.write(`${table ?? "No stored screenshots changed."}\n`);
  if (!argv.includes("--write")) return;
  const body = gh(["pr", "view", "--json", "body", "-q", ".body"]);
  gh(["pr", "edit", "--body-file", "-"], replaceSection(body, table));
  process.stderr.write("PR description updated.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
