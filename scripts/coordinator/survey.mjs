#!/usr/bin/env node
// PR survey for a coordinator (AI-149; runbook `coordinating-sessions.md` §6). Read-only.
// For each PR: head, merge state, whether the head contains the base branch, checks, each review
// agent's verdict and blocking findings on that head, labels, and which ADR-0092 high-risk paths
// the diff touches. `ready` applies coordinate.md §7's mechanical conditions; the risk class is
// still the coordinator's call.
//
// Usage: node scripts/coordinator/survey.mjs [PR...] [--json]   (no PR: every open PR)
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  BLOCKING,
  ghJson,
  ghLines,
  highRiskTouched,
  latestReviews,
  parseReview,
  readHighRiskPatterns,
  sh,
} from "./lib.mjs";

const PR_FIELDS =
  "number,title,state,isDraft,baseRefName,headRefName,headRefOid,mergeStateStatus,labels,isCrossRepository,url";

/** Counts checks by gh's bucket (pass, fail, pending, skipping, cancel). */
export function countChecks(checks) {
  const counts = { pass: 0, fail: 0, pending: 0, skipping: 0, cancel: 0 };
  for (const c of checks) counts[c.bucket] = (counts[c.bucket] ?? 0) + 1;
  return {
    ...counts,
    failing: checks.filter((c) => c.bucket === "fail" || c.bucket === "cancel").map((c) => c.name),
  };
}

/** Tries one step; a failure becomes `{ error }` so one bad call never reads as a pass. */
function attempt(fn) {
  try {
    return fn();
  } catch (error) {
    return { error: error.message };
  }
}

/** Gathers everything the coordinator reads before merging one PR. */
export function surveyPr(number, { run = sh, patterns }) {
  const pr = ghJson(run, ["pr", "view", String(number), "--json", PR_FIELDS]);
  const head = pr.headRefOid;
  const sync = attempt(() => {
    const compare = ghJson(run, [
      "api",
      `repos/{owner}/{repo}/compare/${pr.baseRefName}...${head}`,
      "--jq",
      "{status: .status, behind_by: .behind_by}",
    ]);
    if (!Number.isInteger(compare.behind_by)) throw new Error("compare returned no behind_by");
    return { containsBase: compare.behind_by === 0, behindBy: compare.behind_by };
  });
  const checks = attempt(() =>
    countChecks(
      ghJson(run, ["pr", "checks", String(number), "--json", "name,bucket"], { ok: [0, 1, 8] }),
    ),
  );
  const reviews = attempt(() => {
    const comments = ghLines(run, [
      "api",
      "--paginate",
      `repos/{owner}/{repo}/issues/${number}/comments`,
      "--jq",
      ".[] | {login: .user.login, body: .body, updated_at: .updated_at}",
    ]).map((line) => JSON.parse(line));
    const latest = latestReviews(comments);
    return Object.fromEntries(
      Object.entries(latest).map(([role, body]) => [role, body ? parseReview(body, head) : null]),
    );
  });
  const files = attempt(() =>
    ghLines(run, [
      "api",
      "--paginate",
      `repos/{owner}/{repo}/pulls/${number}/files`,
      "--jq",
      ".[].filename",
    ]),
  );
  const report = {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    head,
    branch: pr.headRefName,
    base: pr.baseRefName,
    state: pr.state,
    draft: pr.isDraft,
    fork: pr.isCrossRepository,
    mergeState: pr.mergeStateStatus,
    labels: (pr.labels ?? []).map((l) => l.name),
    sync,
    checks,
    reviews,
    highRisk: Array.isArray(files) ? highRiskTouched(files, patterns) : files,
  };
  return { ...report, blockers: blockers(report) };
}

/**
 * Why a PR may not merge under coordinate.md §7, or [] when every mechanical condition holds.
 * Fails closed: anything unread (an API error, no verdict, unparseable counts) is a reason.
 */
export function blockers(r) {
  const out = [];
  if (r.state !== "OPEN") out.push(`state ${r.state}`);
  if (r.draft) out.push("draft");
  if (r.fork) out.push("from a fork");
  if (r.base !== "main") out.push(`base is ${r.base}, not main`);
  if (!["CLEAN", "HAS_HOOKS"].includes(r.mergeState)) out.push(`merge state ${r.mergeState}`);
  if (r.labels.length > 0) out.push(`labels: ${r.labels.join(", ")}`);
  if (r.sync.error) out.push(`sync unknown (${r.sync.error})`);
  else if (!r.sync.containsBase) out.push(`head is ${r.sync.behindBy} commit(s) behind ${r.base}`);
  if (r.checks.error) out.push(`checks unknown (${r.checks.error})`);
  else {
    if (r.checks.failing.length > 0) out.push(`failing checks: ${r.checks.failing.join(", ")}`);
    if (r.checks.pending > 0) out.push(`${r.checks.pending} check(s) pending`);
    if (r.checks.pass === 0) out.push("no passed checks");
  }
  if (r.reviews.error) out.push(`reviews unknown (${r.reviews.error})`);
  else {
    for (const [role, review] of Object.entries(r.reviews)) {
      if (!review) out.push(`no ${role} verdict`);
      else if (!review.onHead) out.push(`${role} verdict is not on the head`);
      else if (!review.counts) out.push(`${role} verdict has no finding counts`);
      else {
        const open = BLOCKING.filter((s) => (review.counts[s] ?? 0) > 0);
        if (open.length > 0)
          out.push(`${role}: ${open.map((s) => `${s} ${review.counts[s]}`).join(", ")}`);
      }
    }
  }
  return out;
}

const short = (sha) => String(sha ?? "").slice(0, 7);

/** Plain-text report for one PR. */
export function format(r) {
  const lines = [`#${r.number} ${r.title} (head ${short(r.head)}, ${r.branch})`];
  const sync = r.sync.error
    ? `unknown: ${r.sync.error}`
    : r.sync.containsBase
      ? "yes"
      : `no (${r.sync.behindBy} behind)`;
  lines.push(
    `  merge state ${r.mergeState} · contains ${r.base}: ${sync} · labels: ${r.labels.join(", ") || "none"}`,
  );
  lines.push(
    r.checks.error
      ? `  checks: unknown: ${r.checks.error}`
      : `  checks: ${r.checks.pass} passed, ${r.checks.failing.length} failing, ${r.checks.pending} pending, ${r.checks.skipping} skipped${r.checks.failing.length ? ` (${r.checks.failing.join(", ")})` : ""}`,
  );
  if (r.reviews.error) lines.push(`  reviews: unknown: ${r.reviews.error}`);
  else {
    for (const [role, review] of Object.entries(r.reviews)) {
      if (!review) {
        lines.push(`  ${role}: no verdict`);
        continue;
      }
      const where = review.onHead ? "on head" : `on ${short(review.sha) || "no sha"}, not the head`;
      lines.push(`  ${role}: ${review.verdict} (${where})`);
      for (const f of review.blocking) lines.push(`    ${f.severity}: ${f.title}`);
    }
  }
  lines.push(
    Array.isArray(r.highRisk)
      ? `  high-risk paths (ADR-0092): ${r.highRisk.join(", ") || "none"}`
      : `  high-risk paths: unknown: ${r.highRisk.error}`,
  );
  lines.push(
    r.blockers.length
      ? `  not mergeable: ${r.blockers.join("; ")}`
      : "  mergeable by §7's mechanical rules (class is yours)",
  );
  return lines.join("\n");
}

export function openPrNumbers(run = sh) {
  return ghJson(run, ["pr", "list", "--state", "open", "--limit", "200", "--json", "number"]).map(
    (p) => p.number,
  );
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: survey.mjs [PR...] [--json]\nRead-only. Reports head, sync, checks, review verdicts and high-risk paths for the given PRs (default: all open).\n",
    );
    return 0;
  }
  const patterns = readHighRiskPatterns();
  const numbers = positionals.length ? positionals.map(Number) : openPrNumbers();
  const reports = numbers.map((n) => attempt(() => surveyPr(n, { patterns })));
  if (values.json) process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  else
    process.stdout.write(
      `${reports.map((r, i) => (r.error ? `#${numbers[i]}: ${r.error}` : format(r))).join("\n\n")}\n`,
    );
  return reports.some((r) => r.error) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
