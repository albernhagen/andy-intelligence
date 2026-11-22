#!/usr/bin/env node
// Context budget check (ADR-0046): agent-loaded docs stay small enough to read quickly and
// cheaply. Budgets live in `context-budget.json` at the repo root; without one, every
// AGENTS.md / CLAUDE.md gets the Claude Code guidance of 200 lines. For each tracked file the
// first matching entry applies. Symlinks are skipped (CLAUDE.md → AGENTS.md is counted once).
//
// Half the room (AI-143): two PRs that each pass can still push `main` over together, because
// `main` doesn't require PRs to be up to date. So a PR that grows a budgeted file that already
// exists on the base may use at most half the room left in it: floor((budget - base) / 2). Any
// two open PRs growing one file then fit together. New files are exempt (two PRs can't both add
// one path without a conflict). The base is `--base <ref>`, or on a pull request the base the
// checked-out merge commit was built on (else `origin/$GITHUB_BASE_REF`), fetched here; without
// one, only budgets apply. A base that can't be
// read fails the check (exit 2): a skipped check would let two PRs push `main` over. A repo whose
// CI can't fetch its base (private, no credentials) sets CONTEXT_BUDGET_BASE=none to opt out.
//
// Usage: node scripts/context-budget.mjs [repo-dir] [--base <ref>]. Exit 1 when a file is over
// budget or uses more than half the room, 2 on a bad config.
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

/**
 * Files that grew against the base by more than half the room they had. `readBase(path)` returns
 * the base text, or null when the file is new.
 * @returns {string[]}
 */
export function checkHeadroom(results, readBase) {
  const problems = [];
  for (const r of results) {
    const baseText = readBase(r.path);
    if (baseText === null) continue;
    const base = measure(baseText);
    for (const [unit, now, was, max] of [
      ["words", r.words, base.words, r.maxWords],
      ["lines", r.lines, base.lines, r.maxLines],
    ]) {
      if (max === undefined || now <= was) continue;
      const allowed = Math.max(0, Math.floor((max - was) / 2));
      if (now - was > allowed) {
        problems.push(
          `${r.path}: grew ${now - was} ${unit} (${was} → ${now}/${max}); a PR may use at most half the room left: ${allowed}`,
        );
      }
    }
  }
  return problems;
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

/**
 * `--base <ref>` from the arguments, else the pull request's base branch on GitHub Actions unless
 * CONTEXT_BUDGET_BASE=none.
 */
export function baseRefFrom(args, env) {
  const at = args.indexOf("--base");
  if (at !== -1) return { ref: args[at + 1], fetch: false };
  if (env.CONTEXT_BUDGET_BASE === "none") return null;
  if (env.GITHUB_BASE_REF) return { ref: env.GITHUB_BASE_REF, fetch: true };
  return null;
}

/** A reader of files at the base. Throws when the base can't be read (a fetch is tried twice). */
function baseReader(dir, base) {
  const git = (args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let ref = base.ref;
  if (base.fetch) {
    // A pull request checks out GitHub's merge commit; its first parent is the base it was
    // built on. Comparing with the branch's current tip instead would count main's later trims
    // as this PR's growth. No merge commit (another checkout): the branch tip.
    const parents = git(["cat-file", "-p", "HEAD"])
      .split("\n")
      .flatMap((l) => l.match(/^parent ([0-9a-f]{40})$/)?.[1] ?? []);
    const want = parents.length === 2 ? parents[0] : base.ref;
    const fetch = () => git(["fetch", "--no-tags", "--depth=1", "origin", want]);
    try {
      fetch();
    } catch {
      fetch();
    }
    ref = "FETCH_HEAD";
  }
  ref = git(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  return (path) => {
    try {
      return git(["show", `${ref}:${path}`]);
    } catch {
      return null;
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--base") ?? ".";
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
  const base = baseRefFrom(args, process.env);
  let readBase = null;
  if (base) {
    try {
      readBase = baseReader(dir, base);
    } catch (err) {
      process.stderr.write(
        `context budget: can't read base ${base.ref} (${err.message.split("\n")[0]}). A repo whose CI can't fetch it sets CONTEXT_BUDGET_BASE=none to check budgets only (AI-143).\n`,
      );
      process.exit(2);
    }
  }
  if (readBase) {
    const problems = checkHeadroom(results, readBase);
    for (const p of problems) process.stdout.write(`ROOM ${p}\n`);
    if (problems.length > 0) {
      process.stdout.write(
        `\nMore than half the room used: trim the file in this PR so parallel PRs can't push main over together (AI-143).\n`,
      );
      process.exit(1);
    }
  }
}
