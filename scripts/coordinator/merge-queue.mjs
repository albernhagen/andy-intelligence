#!/usr/bin/env node
// Serial merge queue for a coordinator acting under ADR-0120 (AI-149; runbook
// `coordinating-sessions.md` §7). CHANGES REMOTE STATE: squash-merges PRs on GitHub and deletes
// their branches. Not for build agents.
//
// Takes an explicit list of PRs the coordinator has already judged its own to merge; it never
// decides that. Before each merge it re-surveys the PR and merges only when survey.mjs finds no
// blocker (head contains main, every check passed, both verdicts on that head with zero blocker,
// should-fix, high and critical, no labels, no ADR-0120 "Andy keeps" path, file list read). After each merge it waits for main's runs on
// the merge commit and stops on any failure or timeout. A PR that is not ready is skipped with
// its reasons; after one merge the rest are usually behind main and need resync.mjs first.
//
// Usage: node scripts/coordinator/merge-queue.mjs <PR> [PR...] [--dry-run] [--timeout-min 45]
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { ghJson, readPatterns, sh, sleep as realSleep } from "./lib.mjs";
import { surveyPr } from "./survey.mjs";

const OK_CONCLUSIONS = ["success", "skipped", "neutral"];
const POLL_MS = 30_000;
/** Runs can take a minute to appear after a push; no runs after this long is a failure. */
const APPEAR_MS = 3 * 60_000;

/**
 * Waits until every workflow run on `sha` of main has completed.
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
export async function waitForMain(sha, { run = sh, sleep = realSleep, timeoutMs, now = Date.now }) {
  const start = now();
  for (;;) {
    let runs;
    try {
      runs = ghJson(run, [
        "run",
        "list",
        "--branch",
        "main",
        "--commit",
        sha,
        "--limit",
        "100",
        "--json",
        "name,status,conclusion,url",
      ]);
    } catch (error) {
      return { ok: false, reason: `can't read main's runs: ${error.message}` };
    }
    const elapsed = now() - start;
    const failed = runs.filter(
      (r) => r.status === "completed" && !OK_CONCLUSIONS.includes(r.conclusion),
    );
    if (failed.length > 0) {
      return {
        ok: false,
        reason: `main is red on ${sha.slice(0, 7)}: ${failed.map((r) => `${r.name} ${r.conclusion} ${r.url}`).join("; ")}`,
      };
    }
    if (runs.length > 0 && runs.every((r) => r.status === "completed")) {
      return { ok: true, reason: `main green on ${sha.slice(0, 7)} (${runs.length} runs)` };
    }
    if (runs.length === 0 && elapsed > APPEAR_MS) {
      return { ok: false, reason: `no runs appeared on main for ${sha.slice(0, 7)}` };
    }
    if (elapsed > timeoutMs) {
      return {
        ok: false,
        reason: `main's runs on ${sha.slice(0, 7)} still running after ${Math.round(timeoutMs / 60_000)} min`,
      };
    }
    await sleep(POLL_MS);
  }
}

function mainHead(run) {
  return ghJson(run, ["api", "repos/{owner}/{repo}/commits/main", "--jq", "{sha: .sha}"]).sha;
}

/** Merges the PR at exactly the surveyed head, then deletes its branch on GitHub only. */
function merge(report, run) {
  const r = run("gh", [
    "pr",
    "merge",
    String(report.number),
    "--squash",
    "--match-head-commit",
    report.head,
  ]);
  const after = ghJson(run, ["pr", "view", String(report.number), "--json", "state,mergeCommit"]);
  if (after.state !== "MERGED" || !after.mergeCommit?.oid) {
    throw new Error(
      `merge of #${report.number} failed: ${r.stderr.trim() || `state ${after.state}`}`,
    );
  }
  // gh's --delete-branch also deletes the local branch, which fails while a worker's worktree has
  // it checked out; delete only the remote ref. A failure here is reported, not fatal.
  const del = run("gh", [
    "api",
    "-X",
    "DELETE",
    `repos/{owner}/{repo}/git/refs/heads/${report.branch}`,
  ]);
  return { sha: after.mergeCommit.oid, branchDeleted: del.status === 0 };
}

/**
 * Runs the queue. `log` receives one plain line per event.
 * @returns {Promise<{ merged: number[], skipped: {number: number, reasons: string[]}[], stopped: string|null }>}
 */
export async function runQueue(
  numbers,
  {
    run = sh,
    sleep = realSleep,
    now = Date.now,
    patterns,
    dryRun = false,
    timeoutMs = 45 * 60_000,
    log = () => {},
  },
) {
  const result = { merged: [], skipped: [], stopped: null };
  const stop = (reason) => {
    result.stopped = reason;
    log(`STOP: ${reason}`);
    return result;
  };
  let main;
  try {
    main = mainHead(run);
  } catch (error) {
    return stop(`can't read main: ${error.message}`);
  }
  const first = await waitForMain(main, { run, sleep, timeoutMs, now });
  if (!first.ok) return stop(`before any merge: ${first.reason}`);
  log(first.reason);

  for (const number of numbers) {
    let report;
    try {
      report = surveyPr(number, { run, patterns });
    } catch (error) {
      result.skipped.push({ number, reasons: [error.message] });
      log(`#${number}: skipped: ${error.message}`);
      continue;
    }
    if (report.blockers.length > 0) {
      result.skipped.push({ number, reasons: report.blockers });
      log(`#${number}: skipped: ${report.blockers.join("; ")}`);
      continue;
    }
    if (dryRun) {
      log(`#${number}: would merge at ${report.head.slice(0, 7)} (dry run)`);
      continue;
    }
    let merged;
    try {
      merged = merge(report, run);
    } catch (error) {
      return stop(error.message);
    }
    result.merged.push(number);
    log(
      `#${number}: merged as ${merged.sha.slice(0, 7)}${merged.branchDeleted ? "" : ` (branch ${report.branch} not deleted)`}`,
    );
    const waited = await waitForMain(merged.sha, { run, sleep, timeoutMs, now });
    if (!waited.ok) return stop(waited.reason);
    log(waited.reason);
  }
  return result;
}

const HELP = `Usage: merge-queue.mjs <PR> [PR...] [--dry-run] [--timeout-min 45]

CHANGES REMOTE STATE: squash-merges the listed PRs on GitHub, one at a time, and deletes
their branches. For a coordinator acting under ADR-0120 only, never for build agents.
List only PRs you have judged yours to merge; this tool does not decide that, but refuses
any PR touching a path in ADR-0120's "Andy keeps" table, or whose files it can't read.
Merges a PR only when survey.mjs finds no blocker on its head; waits for main's runs after
each merge and stops on any failure. --dry-run reports what it would merge.
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean" },
      "timeout-min": { type: "string", default: "45" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return values.help ? 0 : 2;
  }
  const numbers = positionals.map(Number);
  if (numbers.some((n) => !Number.isInteger(n) || n <= 0)) {
    process.stderr.write(`PR numbers only: ${positionals.join(" ")}\n`);
    return 2;
  }
  const result = await runQueue(numbers, {
    patterns: readPatterns(),
    dryRun: values["dry-run"],
    timeoutMs: Number(values["timeout-min"]) * 60_000,
    log: (line) => process.stdout.write(`${line}\n`),
  });
  process.stdout.write(
    `merged: ${result.merged.map((n) => `#${n}`).join(", ") || "none"}; skipped: ${result.skipped.map((s) => `#${s.number}`).join(", ") || "none"}\n`,
  );
  return result.stopped ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
