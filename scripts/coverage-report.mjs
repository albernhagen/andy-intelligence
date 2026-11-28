#!/usr/bin/env node
// Test coverage report (AI-407). Runs after the coverage floors are checked (vitest `--coverage`):
// writes a per-package table and, on a pull request, the coverage of the PR's changed lines to the
// job summary. Changed-line coverage is a warning only, never a failure; the floors in each repo's
// vitest config are the gate. No dependencies: managed repos run it from the pinned action.
//
// CLI: coverage-report.mjs <coverage dir> [<diff file>]. Reads coverage-summary.json and
// coverage-final.json (vitest reporters json-summary and json) from the dir, and, when given, a
// `git diff --unified=0` of the PR. Appends markdown to $GITHUB_STEP_SUMMARY (stdout without it).
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const METRICS = ["lines", "statements", "functions", "branches"];
const WORKSPACE_DIRS = new Set(["apps", "packages", "libs", "services"]);
/** Below this, changed-line coverage gets a warning annotation. */
export const CHANGED_LINES_WARN = 80;

/** The package a repo-relative file belongs to: `apps/api`, `packages/domain`, or its top dir. */
export function groupOf(file) {
  const parts = file.split("/");
  if (parts.length === 1) return "(root)";
  if (WORKSPACE_DIRS.has(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

/** Sums a coverage-summary.json (absolute or relative keys) per package, sorted by name. */
export function summarize(summary, root) {
  const groups = new Map();
  for (const [file, data] of Object.entries(summary)) {
    if (file === "total") continue;
    const name = groupOf(toRelative(file, root));
    const group = groups.get(name) ?? Object.fromEntries(METRICS.map((m) => [m, [0, 0]]));
    for (const m of METRICS) {
      group[m][0] += data[m]?.covered ?? 0;
      group[m][1] += data[m]?.total ?? 0;
    }
    groups.set(name, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, group]) => ({
      name,
      ...Object.fromEntries(METRICS.map((m) => [m, pct(...group[m])])),
    }));
}

/** Changed (added or modified) lines per file from a `git diff --unified=0`. */
export function changedLines(diff) {
  const files = new Map();
  let current = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      current = path === "/dev/null" ? null : path.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const set = files.get(current) ?? new Set();
      for (let n = start; n < start + count; n++) set.add(n);
      files.set(current, set);
    }
  }
  return files;
}

/**
 * Line hits from an istanbul file record (coverage-final.json): a line is covered when any
 * statement starting on it ran, uncovered when statements start on it and none ran.
 */
export function lineHits(record) {
  const hits = new Map();
  for (const [id, loc] of Object.entries(record.statementMap ?? {})) {
    const line = loc.start.line;
    hits.set(line, (hits.get(line) ?? 0) + (record.s?.[id] ?? 0));
  }
  return hits;
}

/**
 * Coverage of the changed lines that hold code, across files the coverage report measured.
 * Files it doesn't measure (docs, tests, config) don't count.
 */
export function changedLineCoverage(final, diff, root) {
  const changed = changedLines(diff);
  const files = [];
  let covered = 0;
  let total = 0;
  for (const [abs, record] of Object.entries(final)) {
    const file = toRelative(abs, root);
    const lines = changed.get(file);
    if (!lines) continue;
    const hits = lineHits(record);
    const missed = [];
    let fileTotal = 0;
    for (const n of [...lines].sort((a, b) => a - b)) {
      if (!hits.has(n)) continue;
      fileTotal++;
      if (hits.get(n) > 0) covered++;
      else missed.push(n);
    }
    total += fileTotal;
    if (fileTotal > 0) files.push({ file, total: fileTotal, missed });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  return { covered, total, percent: total === 0 ? null : pct(covered, total), files };
}

/** Collapses sorted line numbers into ranges: [3,4,5,9] → "3-5, 9". */
export function ranges(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++;
    out.push(i === j ? `${lines[i]}` : `${lines[i]}-${lines[j]}`);
    i = j;
  }
  return out.join(", ");
}

/** The job-summary markdown, plus the warning annotation (or null). */
export function render(rows, changed) {
  const out = ["## Test coverage", ""];
  out.push("| Package | Lines | Statements | Functions | Branches |");
  out.push("| --- | --: | --: | --: | --: |");
  for (const row of rows)
    out.push(`| ${row.name} | ${METRICS.map((m) => fmt(row[m])).join(" | ")} |`);
  out.push("", "Floors (the gate) are in the repo's vitest config: `coverage.thresholds`.");
  let warning = null;
  if (changed) {
    out.push("", "### Changed lines");
    if (changed.percent === null) {
      out.push("", "No measured code lines changed.");
    } else {
      out.push(
        "",
        `${changed.covered} of ${changed.total} changed code lines run in tests: **${fmt(changed.percent)}**.`,
      );
      const missing = changed.files.filter((f) => f.missed.length > 0);
      if (missing.length > 0) {
        out.push("", "| File | Lines not run |", "| --- | --- |");
        for (const f of missing) out.push(`| \`${f.file}\` | ${ranges(f.missed)} |`);
      }
      if (changed.percent < CHANGED_LINES_WARN) {
        warning = `Changed-line coverage is ${fmt(changed.percent)} (under ${CHANGED_LINES_WARN}%): see the job summary for the lines no test runs`;
      }
    }
  }
  return { markdown: `${out.join("\n")}\n`, warning };
}

function pct(covered, total) {
  return total === 0 ? 100 : Math.floor((covered / total) * 1000) / 10;
}

function fmt(value) {
  return `${value.toFixed(1)}%`;
}

function toRelative(file, root) {
  return (file.startsWith("/") ? relative(root, file) : file).split("\\").join("/");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir = "coverage", diffFile] = process.argv.slice(2);
  const root = process.cwd();
  const summaryFile = `${dir}/coverage-summary.json`;
  if (!existsSync(summaryFile)) {
    process.stdout.write(
      `::error::No ${summaryFile}: add "json-summary" and "json" to coverage.reporter in the vitest config\n`,
    );
    process.exit(1);
  }
  const rows = summarize(JSON.parse(readFileSync(summaryFile, "utf8")), root);
  let changed = null;
  const finalFile = `${dir}/coverage-final.json`;
  if (diffFile && existsSync(finalFile)) {
    changed = changedLineCoverage(
      JSON.parse(readFileSync(finalFile, "utf8")),
      readFileSync(diffFile, "utf8"),
      root,
    );
  }
  const { markdown, warning } = render(rows, changed);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  else process.stdout.write(markdown);
  if (warning) process.stdout.write(`::warning::${warning}\n`);
}
