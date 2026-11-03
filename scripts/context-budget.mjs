#!/usr/bin/env node
// Context budget check (ADR-0046): agent-loaded docs stay small enough to read quickly and
// cheaply. Budgets live in `context-budget.json` at the repo root; without one, every
// AGENTS.md / CLAUDE.md gets the Claude Code guidance of 200 lines. For each tracked file the
// first matching entry applies. Symlinks are skipped (CLAUDE.md → AGENTS.md is counted once).
//
// Usage: node scripts/context-budget.mjs [repo-dir]. Exit 1 when a file is over budget, 2 on a
// bad config.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BUDGETS = [
  { pattern: "**/AGENTS.md", maxLines: 200 },
  { pattern: "**/CLAUDE.md", maxLines: 200 },
];

/** Minimal glob: `**` spans directories (including none), `*` stays within one. */
export function globToRegExp(pattern) {
  const re = pattern
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => {
      if (part === "**/") return "(?:.*/)?";
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${re}$`);
}

export function measure(text) {
  const trimmed = text.replace(/\n+$/, "");
  return {
    lines: trimmed === "" ? 0 : trimmed.split("\n").length,
    words: (text.match(/\S+/g) ?? []).length,
  };
}

/** @returns {{ path: string, lines: number, words: number, maxLines?: number, maxWords?: number, over: boolean }[]} */
export function check(files, budgets, read) {
  const matchers = budgets.map((b) => ({ ...b, re: globToRegExp(b.pattern) }));
  const results = [];
  for (const path of files) {
    const budget = matchers.find((m) => m.re.test(path));
    if (!budget) continue;
    const { lines, words } = measure(read(path));
    const over =
      (budget.maxLines !== undefined && lines > budget.maxLines) ||
      (budget.maxWords !== undefined && words > budget.maxWords);
    results.push({
      path,
      lines,
      words,
      maxLines: budget.maxLines,
      maxWords: budget.maxWords,
      over,
    });
  }
  return results;
}

export function loadBudgets(dir) {
  const file = join(dir, "context-budget.json");
  if (!existsSync(file)) return DEFAULT_BUDGETS;
  const { budgets } = JSON.parse(readFileSync(file, "utf8"));
  const valid =
    Array.isArray(budgets) &&
    budgets.every(
      (b) =>
        typeof b.pattern === "string" &&
        (Number.isInteger(b.maxLines) || Number.isInteger(b.maxWords)),
    );
  if (!valid) throw new Error(`${file}: "budgets" must list { pattern, maxLines and/or maxWords }`);
  return budgets;
}

const limit = (value, max, unit) => `${value}${max === undefined ? "" : `/${max}`} ${unit}`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? ".";
  let budgets;
  try {
    budgets = loadBudgets(dir);
  } catch (err) {
    process.stderr.write(`context budget: ${err.message}\n`);
    process.exit(2);
  }
  const files = execFileSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && existsSync(join(dir, f)) && !lstatSync(join(dir, f)).isSymbolicLink());
  const results = check(files, budgets, (f) => readFileSync(join(dir, f), "utf8"));
  for (const r of results) {
    const status = r.over ? "OVER" : "ok  ";
    process.stdout.write(
      `${status} ${r.path}: ${limit(r.lines, r.maxLines, "lines")}, ${limit(r.words, r.maxWords, "words")}\n`,
    );
  }
  if (results.some((r) => r.over)) {
    process.stdout.write(
      "\nOver budget: trim the file (move detail to an on-demand doc) rather than raising the budget (ADR-0046).\n",
    );
    process.exit(1);
  }
}
