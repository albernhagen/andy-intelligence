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
// A PR's own change (AI-344, ADR-0138): with a base, a PR fails only for what it did: growing a
// file past half the room (none left on a file already over, so any growth there fails) or adding
// a new file over budget. A file over on the base that the PR didn't grow is reported, not failed,
// so three PRs that overflow `main` together block nobody after them. `--report` (CI on `main`)
// warns in the job summary and exits 0; `context-budget-issue.mjs` records one trim issue.
// Locally (no base) every file over budget fails, so nothing is hidden.
//
// Usage: node scripts/context-budget.mjs [repo-dir] [--base <ref>] [--report]. Exit 1 when a file
// is over budget (locally) or the PR breaks a rule above, 2 on a bad config.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, readFileSync } from "node:fs";
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

/**
 * What fails a PR (AI-344): growth past its allowance (`checkHeadroom`), or a new file over
 * budget. `untouched` lists files over budget that the PR didn't grow: reported, not failed.
 * @returns {{ problems: string[], untouched: string[] }}
 */
export function prFailures(results, readBase) {
  const problems = checkHeadroom(results, readBase);
  const failed = new Set(problems.map((p) => p.slice(0, p.indexOf(":"))));
  const untouched = [];
  for (const r of results.filter((x) => x.over)) {
    if (readBase(r.path) === null) {
      problems.push(`${r.path}: a new file over budget (${describe(r)})`);
    } else if (!failed.has(r.path)) {
      untouched.push(r.path);
    }
  }
  return { problems, untouched };
}

/** The job summary for `main` (AI-344): a warning table of files over budget, or nothing. */
export function reportSummary(results) {
  const over = results.filter((r) => r.over);
  if (over.length === 0) return "";
  const rows = over.map((r) => `| \`${r.path}\` | ${describe(r)} |`);
  return [
    "### Context budget: files over on main",
    "",
    "CI stays green; one trim issue tracks them (AI-344). Trim, don't raise a budget (ADR-0046).",
    "",
    "| File | Size |",
    "|---|---|",
    ...rows,
  ].join("\n");
}

/** Tracked files, without symlinks (CLAUDE.md → AGENTS.md is counted once). */
export function trackedFiles(dir) {
  return execFileSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && existsSync(join(dir, f)) && !lstatSync(join(dir, f)).isSymbolicLink());
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
/** "47/40 lines, 650/600 words": the units the file has a budget in. */
export function describe(r) {
  const parts = [];
  if (r.maxLines !== undefined) parts.push(limit(r.lines, r.maxLines, "lines"));
  if (r.maxWords !== undefined) parts.push(limit(r.words, r.maxWords, "words"));
  return parts.join(", ");
}

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

/**
 * Renamed paths from `git diff --name-status -M --diff-filter=R` ("R095\told\tnew"): new → old.
 * A moved file is judged against its old content, not as a new file (AI-344).
 */
export function renamesFrom(stdout) {
  const map = new Map();
  for (const line of stdout.split("\n")) {
    const [status, from, to] = line.split("\t");
    if (status?.startsWith("R") && from && to) map.set(to, from);
  }
  return map;
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
  // The working tree against the base: a CI merge commit's checkout, or a local branch.
  const renames = renamesFrom(git(["diff", "--name-status", "-M", "--diff-filter=R", ref]));
  return (path) => {
    try {
      return git(["show", `${ref}:${renames.get(path) ?? path}`]);
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
  const results = check(trackedFiles(dir), budgets, (f) => readFileSync(join(dir, f), "utf8"));
  for (const r of results) {
    const status = r.over ? "OVER" : "ok  ";
    process.stdout.write(
      `${status} ${r.path}: ${limit(r.lines, r.maxLines, "lines")}, ${limit(r.words, r.maxWords, "words")}\n`,
    );
  }
  const over = results.filter((r) => r.over);

  if (args.includes("--report")) {
    // `main` (AI-344): over budget warns and a trim issue follows; it never fails CI.
    for (const r of over) {
      process.stdout.write(`::warning file=${r.path}::Over its context budget: ${describe(r)}\n`);
    }
    const summary = reportSummary(results);
    if (summary && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    }
    process.exit(0);
  }

  const base = baseRefFrom(args, process.env);
  if (!base) {
    if (over.length > 0) {
      process.stdout.write(
        "\nOver budget: trim the file (move detail to an on-demand doc) rather than raising the budget (ADR-0046).\n",
      );
      process.exit(1);
    }
    process.exit(0);
  }
  let readBase;
  try {
    readBase = baseReader(dir, base);
  } catch (err) {
    process.stderr.write(
      `context budget: can't read base ${base.ref} (${err.message.split("\n")[0]}). A repo whose CI can't fetch it sets CONTEXT_BUDGET_BASE=none to check budgets only (AI-143).\n`,
    );
    process.exit(2);
  }
  const { problems, untouched } = prFailures(results, readBase);
  for (const p of untouched) {
    process.stdout.write(
      `NOTE ${p}: over budget on the base and not grown here; a trim follows on main\n`,
    );
  }
  for (const p of problems) process.stdout.write(`FAIL ${p}\n`);
  if (problems.length > 0) {
    process.stdout.write(
      `\nTrim the file in this PR: a PR may use at most half the room left, none on a file already over (AI-143, AI-344).\n`,
    );
    process.exit(1);
  }
}
