#!/usr/bin/env node
// Re-sync open PRs (AI-147, ADR-0111). Runs on GitHub Actions when the default branch moves:
// each open same-repo PR that lacks the new head gets it merged in by GitHub's update-branch API
// (a merge commit, never a rebase or force push). Clean merges only: git computes the merge
// in memory first (`git merge-tree`, objects only, no checkout, no PR code runs), and a conflict
// leaves one comment on the PR naming the files instead.
//
// Skipped: forks, drafts, the opt-out label, agent PRs (sync tasks own them, ADR-0083), Dependabot
// (it rebases its own). Caps (ADR-0028): re-syncs per hour, PRs per run, updates per PR per day.
// Fails closed: a shared failure (token, a fetch, the hourly count) stops the run; one PR's failure
// writes nothing more for that PR, the rest go on, and the run exits non-zero.
//
// Env: REPO (owner/name), DEFAULT_BRANCH, READ_TOKEN (the job's GITHUB_TOKEN: fetch, list
// PRs and comments), CONTROL_PLANE_URL, ACTIONS_ID_TOKEN_REQUEST_URL,
// ACTIONS_ID_TOKEN_REQUEST_TOKEN, GITHUB_STEP_SUMMARY (optional). The write token comes from the
// control plane (POST /github/token, ADR-0043) and only updates branches and writes the comment.
// First, the project's PR sync setting (POST /github/pr-sync, AI-388): `queue` ends the run there.
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanGitEnv } from "./git-env.mjs";

/**
 * Runs that re-synced a PR in the last hour (AI-345, ADR-0139). Counted from the branches, not the
 * Actions API: skipped, capped and no-op runs merge nothing, so they don't count.
 */
export const MAX_RUNS_PER_HOUR = 12;
export const MAX_PRS_PER_RUN = 20;
export const MAX_UPDATES_PER_PR_PER_DAY = 3;
/** Open PRs listed at most (100 per page). */
export const MAX_PR_PAGES = 3;
/** Comments read per PR to find our own (100 per page). */
export const MAX_COMMENT_PAGES = 3;
export const MAX_FILES_NAMED = 50;
export const OPT_OUT_LABEL = "no-auto-sync";
export const COMMENT_MARKER = "<!-- resync-prs (ADR-0111) -->";

const AGENT_BRANCH = /^agent\//;
const SKIP_AUTHORS = new Set(["dependabot[bot]"]);
const SHA = /^[0-9a-f]{40}$/;
const API = "https://api.github.com";

/** Why a PR is left alone, or null when it may be re-synced. */
export function skipReason(pr, { repo, defaultBranch }) {
  if (pr.base?.ref !== defaultBranch) return "targets another branch";
  if (pr.head?.repo?.full_name !== repo) return "from a fork";
  if (pr.draft) return "draft";
  if ((pr.labels ?? []).some((l) => l?.name === OPT_OUT_LABEL)) return `labelled ${OPT_OUT_LABEL}`;
  if (AGENT_BRANCH.test(pr.head?.ref ?? "")) return "agent PR: sync tasks keep it current";
  if (SKIP_AUTHORS.has(pr.user?.login)) return "Dependabot rebases its own PRs";
  if (!SHA.test(pr.head?.sha ?? "")) return "no head commit";
  return null;
}

/**
 * Eligible PRs, least recently updated first, at most MAX_PRS_PER_RUN. A PR updated by a run moves
 * to the back, so PRs past the cap go first next time.
 */
export function pickPrs(prs, ctx) {
  const skipped = [];
  const eligible = [];
  for (const pr of prs) {
    const reason = skipReason(pr, ctx);
    if (reason) skipped.push({ number: pr.number, outcome: "skipped", detail: reason });
    else eligible.push(pr);
  }
  eligible.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
  // A PR re-synced this hour moves to the back, so the hourly count reads every eligible PR.
  const overCap = eligible.slice(MAX_PRS_PER_RUN).map((pr) => ({
    number: pr.number,
    outcome: "skipped",
    detail: `over the cap of ${MAX_PRS_PER_RUN} PRs per run: next run`,
  }));
  return {
    eligible,
    candidates: eligible.slice(0, MAX_PRS_PER_RUN),
    skipped: [...skipped, ...overCap],
  };
}

/**
 * The start of the message GitHub's update-branch (and `gh pr update-branch`, and a local
 * `git merge main`) gives its merge commit. The daily cap counts these on the branch: any merge of
 * the default branch in 24 hours, whoever made it.
 */
export function mergeMessage(defaultBranch) {
  return `Merge branch '${defaultBranch}' into `;
}

/**
 * The default-branch commits merged in, from `git log --merges --format=%P` (one line per merge:
 * the branch's parent, then the merged commit). Each re-syncing run merges one `main` commit.
 */
export function mergedCommits(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim().split(" ")[1])
    .filter((sha) => SHA.test(sha ?? ""));
}

/** Conflicted paths from `git merge-tree --write-tree --name-only --no-messages` (first line: tree). */
export function conflictFiles(stdout) {
  const lines = stdout.split("\n").slice(1);
  return [...new Set(lines.filter((l) => l !== ""))];
}

/** A path or message as inline code on one line: no backticks, newlines or control characters. */
export function inlineCode(text, max = 200) {
  const clean = [...String(text)]
    .map((ch) => (ch === "`" || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch))
    .join("")
    .slice(0, max);
  return `\`${clean}\``;
}

/** The PR comment for a merge this workflow can't make. One per PR, edited in place. */
export function stopComment({ headSha, mainSha, defaultBranch, files, reason }) {
  const lines = [
    COMMENT_MARKER,
    `**Not re-synced with \`${defaultBranch}\`:** ${reason}`,
    "",
    `PR head \`${headSha.slice(0, 7)}\`, \`${defaultBranch}\` at \`${mainSha.slice(0, 7)}\`.`,
  ];
  if (files.length > 0) {
    lines.push("", "Conflicting files:", "");
    for (const f of files.slice(0, MAX_FILES_NAMED)) lines.push(`- ${inlineCode(f)}`);
    if (files.length > MAX_FILES_NAMED) {
      lines.push(`- … and ${files.length - MAX_FILES_NAMED} more`);
    }
  }
  lines.push(
    "",
    `Merge \`${defaultBranch}\` into the branch by hand (no rebase, no force push). ` +
      `Label \`${OPT_OUT_LABEL}\` to stop these re-syncs.`,
  );
  return lines.join("\n");
}

/** One line for logs and comments, at most 300 characters. */
function oneLine(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** A thin GitHub REST client. Throws on statuses the caller didn't expect. */
export function githubClient(fetchImpl = globalThis.fetch) {
  return async (method, path, { token, body, ok = [200] } = {}) => {
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
    if (!ok.includes(res.status)) {
      throw new Error(`${method} ${path} returned HTTP ${res.status}: ${oneLine(data?.message)}`);
    }
    return { status: res.status, data };
  };
}

/** git in `cwd` without hooks or user config; returns status and output, never throws. */
export function gitRunner(cwd) {
  return (args, extraEnv = {}) => {
    const res = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      encoding: "utf8",
      env: {
        ...cleanGitEnv(process.env),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  };
}

/** The job's Actions OIDC token for the control plane (audience: its URL), masked. */
async function oidcToken({ env, fetchImpl, emit }) {
  const audience = encodeURIComponent(env.CONTROL_PLANE_URL);
  const oidcRes = await fetchImpl(`${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${audience}`, {
    headers: { authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  });
  if (!oidcRes.ok) throw new Error(`the Actions OIDC token request returned ${oidcRes.status}`);
  const { value: oidc } = await oidcRes.json();
  emit(`::add-mask::${oidc}`);
  return oidc;
}

/**
 * The project's PR sync setting (AI-388, ADR-0157), read with the same OIDC token: `queue` (the
 * merge queue syncs the PR that is next; this run writes nothing) or `all`. Anything else fails
 * the run, which then writes nothing either.
 */
export async function prSyncSetting({ env, fetchImpl, oidc }) {
  const res = await fetchImpl(`${env.CONTROL_PLANE_URL}/github/pr-sync`, {
    method: "POST",
    headers: { authorization: `Bearer ${oidc}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !["queue", "all"].includes(data?.prSync)) {
    throw new Error(
      `the control plane didn't say the PR sync setting (HTTP ${res.status}): ${oneLine(data?.error)}`,
    );
  }
  return data.prSync;
}

/** The write token from the control plane (ADR-0043), masked. */
async function writeToken({ env, fetchImpl, emit, oidc }) {
  const res = await fetchImpl(`${env.CONTROL_PLANE_URL}/github/token`, {
    method: "POST",
    headers: { authorization: `Bearer ${oidc}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || typeof data?.token !== "string" || data.token === "") {
    throw new Error(
      `the control plane refused a repo token (HTTP ${res.status}): ${oneLine(data?.error)}`,
    );
  }
  emit(`::add-mask::${data.token}`);
  // The actor finds our own comment; without it we'd edit or duplicate someone else's.
  if (typeof data.actor !== "string" || data.actor === "") {
    throw new Error("the control plane's token response names no actor");
  }
  return { token: data.token, actor: data.actor };
}

function requireEnv(env) {
  const names = [
    "REPO",
    "DEFAULT_BRANCH",
    "READ_TOKEN",
    "CONTROL_PLANE_URL",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  ];
  const missing = names.filter((n) => !env[n]);
  if (missing.length > 0) throw new Error(`missing env: ${missing.join(", ")}`);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.REPO)) throw new Error("REPO is malformed");
}

/** Edits our comment on the PR, or adds one; nothing when it already says the same. */
async function upsertComment({ github, env, number, body, write }) {
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const { data } = await github(
      "GET",
      `/repos/${env.REPO}/issues/${number}/comments?per_page=100&page=${page}`,
      { token: env.READ_TOKEN },
    );
    const mine = (data ?? []).find(
      (c) => c.user?.login === write.actor && String(c.body ?? "").startsWith(COMMENT_MARKER),
    );
    if (mine) {
      if (mine.body === body) return "unchanged";
      await github("PATCH", `/repos/${env.REPO}/issues/comments/${mine.id}`, {
        token: write.token,
        body: { body },
      });
      return "edited";
    }
    if ((data ?? []).length < 100) break;
  }
  await github("POST", `/repos/${env.REPO}/issues/${number}/comments`, {
    token: write.token,
    body: { body },
    ok: [201],
  });
  return "posted";
}

/**
 * Runs that re-synced a PR since `since`: the distinct `main` commits merged into the eligible PRs'
 * heads by a merge of the default branch made since then. Throws if a fetch or count fails.
 */
function recentResyncs({ prs, env, git, auth, mainSha, since }) {
  const refspecs = prs.map((pr) => `+refs/pull/${pr.number}/head:refs/resync/${pr.number}`);
  const fetched = git(
    ["fetch", "--quiet", "--no-tags", `https://github.com/${env.REPO}.git`, ...refspecs],
    auth,
  );
  if (fetched.status !== 0) throw new Error("git fetch of the open PRs' heads failed");
  const merged = new Set();
  for (const pr of prs) {
    const log = git([
      "log",
      "--merges",
      `--since=${since}`,
      "--fixed-strings",
      `--grep=${mergeMessage(env.DEFAULT_BRANCH)}`,
      "--format=%P",
      `${mainSha}..refs/resync/${pr.number}`,
    ]);
    if (log.status !== 0) throw new Error(`git log failed for PR #${pr.number}`);
    for (const sha of mergedCommits(log.stdout)) merged.add(sha);
  }
  return merged.size;
}

/** One PR: already current, capped, conflicted, refused or updated. */
async function resyncOne({ pr, env, git, github, write, mainSha, auth }) {
  const { number } = pr;
  const headSha = pr.head.sha;
  const fetched = git(
    [
      "fetch",
      "--quiet",
      "--no-tags",
      `https://github.com/${env.REPO}.git`,
      `refs/pull/${number}/head`,
    ],
    auth,
  );
  if (fetched.status !== 0) throw new Error(`git fetch of PR #${number} failed`);
  const fetchedSha = git(["rev-parse", "FETCH_HEAD"]).stdout.trim();
  if (fetchedSha !== headSha) {
    return { outcome: "skipped", detail: "head moved during the run: next run" };
  }

  const ancestor = git(["merge-base", "--is-ancestor", mainSha, headSha]);
  if (ancestor.status === 0) return { outcome: "current", detail: "already contains main" };
  if (ancestor.status !== 1) throw new Error(`git merge-base failed for PR #${number}`);

  const counted = git([
    "rev-list",
    "--count",
    "--merges",
    "--since=24 hours ago",
    "--fixed-strings",
    `--grep=${mergeMessage(env.DEFAULT_BRANCH)}`,
    `${mainSha}..${headSha}`,
  ]);
  const recent = Number.parseInt(counted.stdout.trim(), 10);
  if (counted.status !== 0 || !Number.isInteger(recent)) {
    throw new Error(`git rev-list failed for PR #${number}`);
  }
  if (recent >= MAX_UPDATES_PER_PR_PER_DAY) {
    return {
      outcome: "skipped",
      detail: `${recent} merges of ${env.DEFAULT_BRANCH} in 24 hours: cap ${MAX_UPDATES_PER_PR_PER_DAY}`,
    };
  }

  const merged = git([
    "merge-tree",
    "--write-tree",
    "--name-only",
    "--no-messages",
    mainSha,
    headSha,
  ]);
  const stop = async (reason, files) => {
    const body = stopComment({
      headSha,
      mainSha,
      defaultBranch: env.DEFAULT_BRANCH,
      files,
      reason,
    });
    const comment = await upsertComment({ github, env, number, body, write });
    return { comment, files };
  };
  if (merged.status === 1) {
    const files = conflictFiles(merged.stdout);
    const { comment } = await stop("merging it conflicts.", files);
    return { outcome: "conflict", detail: `${files.length} file(s); comment ${comment}` };
  }
  if (merged.status !== 0) throw new Error(`git merge-tree failed for PR #${number}`);

  const res = await github("PUT", `/repos/${env.REPO}/pulls/${number}/update-branch`, {
    token: write.token,
    body: { expected_head_sha: headSha },
    ok: [202, 422],
  });
  if (res.status === 202) return { outcome: "updated", detail: `merged ${mainSha.slice(0, 7)}` };
  const message = oneLine(res.data?.message);
  if (/expected head sha/i.test(message)) {
    return { outcome: "skipped", detail: "head moved during the run: next run" };
  }
  const { comment } = await stop(`GitHub refused the update: ${inlineCode(message)}.`, []);
  return { outcome: "refused", detail: `${message}; comment ${comment}` };
}

/**
 * The whole run. Returns the per-PR results; throws (fail closed) on anything unexpected, after
 * recording what it did so far.
 */
export async function resync({ env, git, github, fetchImpl = globalThis.fetch, emit, now }) {
  requireEnv(env);
  const results = [];
  const record = (r) => {
    results.push(r);
    emit(`#${r.number}: ${r.outcome}: ${r.detail}`);
  };

  // AI-388: the project decides. `queue` leaves each PR alone until it is next in the merge queue.
  const oidc = await oidcToken({ env, fetchImpl, emit });
  const prSync = await prSyncSetting({ env, fetchImpl, oidc });
  if (prSync === "queue") {
    emit("PR sync is `queue`: the merge queue syncs the PR that is next; no re-sync");
    return { capped: false, results, prSync };
  }

  const basic = Buffer.from(`x-access-token:${env.READ_TOKEN}`).toString("base64");
  emit(`::add-mask::${basic}`);
  const auth = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
  const branch = env.DEFAULT_BRANCH;
  const fetchedMain = git(
    ["fetch", "--quiet", "--no-tags", `https://github.com/${env.REPO}.git`, `refs/heads/${branch}`],
    auth,
  );
  if (fetchedMain.status !== 0) throw new Error(`git fetch of ${branch} failed`);
  const mainSha = git(["rev-parse", "FETCH_HEAD"]).stdout.trim();
  if (!SHA.test(mainSha)) throw new Error(`could not read the head of ${branch}`);

  const prs = [];
  for (let page = 1; page <= MAX_PR_PAGES; page++) {
    const { data } = await github(
      "GET",
      `/repos/${env.REPO}/pulls?state=open&base=${encodeURIComponent(branch)}&sort=updated&direction=asc&per_page=100&page=${page}`,
      { token: env.READ_TOKEN },
    );
    prs.push(...(data ?? []));
    if ((data ?? []).length < 100) break;
  }
  const { eligible, candidates, skipped } = pickPrs(prs, {
    repo: env.REPO,
    defaultBranch: branch,
  });
  skipped.forEach(record);
  if (candidates.length === 0) return { capped: false, results };

  const since = new Date(now().getTime() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const recent = recentResyncs({ prs: eligible, env, git, auth, mainSha, since });
  if (recent >= MAX_RUNS_PER_HOUR) {
    emit(`::warning::${recent} re-syncs in the last hour (cap ${MAX_RUNS_PER_HOUR}): no re-sync`);
    return { capped: true, results };
  }

  const write = await writeToken({ env, fetchImpl, emit, oidc });
  // A failure on one PR (locked conversation, a 403, a failed fetch) writes nothing more for it
  // and doesn't hold back the PRs after it; the run still ends red. Shared failures above (token,
  // a fetch, the hourly count) stop the whole run.
  for (const pr of candidates) {
    try {
      record({
        number: pr.number,
        ...(await resyncOne({ pr, env, git, github, write, mainSha, auth })),
      });
    } catch (err) {
      record({ number: pr.number, outcome: "error", detail: oneLine(err?.message) });
    }
  }
  return { capped: false, results };
}

/** The run's results as a Markdown table for the job summary. */
export function summaryTable(results) {
  const rows = results.map((r) => `| #${r.number} | ${r.outcome} | ${oneLine(r.detail)} |`);
  return ["| PR | Outcome | Detail |", "|---|---|---|", ...rows].join("\n");
}

async function main() {
  const emit = (line) => process.stdout.write(`${line}\n`);
  let outcome;
  try {
    outcome = await resync({
      env: process.env,
      git: gitRunner(process.cwd()),
      github: githubClient(),
      emit,
      now: () => new Date(),
    });
  } catch (err) {
    emit(`::error title=resync-prs::${oneLine(err?.message)}`);
    process.exitCode = 1;
    return;
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary =
      outcome.prSync === "queue"
        ? "PR sync is `queue` (project setting): only the PR next in the merge queue is synced, by the queue."
        : summaryTable(outcome.results);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  const failed = outcome.results.filter((r) => r.outcome === "error");
  if (failed.length > 0) {
    emit(`::error title=resync-prs::${failed.length} PR(s) failed: see the job summary`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
