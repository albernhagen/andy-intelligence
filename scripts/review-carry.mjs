#!/usr/bin/env node
// Review carry-forward (ADR-0140): the review agents refuse a run a bot starts, so when the
// re-sync bot (ADR-0111) merges the base branch into a PR, its new head would get no verdict.
// This decides whether the previous verdict still covers the new head. It does only when all hold:
//   1. the new head is a merge whose first parent is the commit the previous verdict reviewed;
//   2. its second parent is on the base branch (the bot merged the base, nothing else);
//   3. the previous verdict passed with no blocking finding and no override label;
//   4. the PR's own diff is the same before and after (`git patch-id --verbatim`, whitespace
//      kept), so the merge brought in no PR change the reviewer didn't see.
// Anything else is "not reviewed", which fails the check; a person pushes to get a real review.
// The workflow checks that the re-sync bot started the run; this never trusts commit authorship.
//
// Env: PREVIOUS_FILE (this role's previous sticky comment), HEAD_SHA (the PR head), BASE_REF.
// Prints `mode=carried` + `carried-from=<sha>`, or `mode=unavailable` + `reason=…`, for
// $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanGitEnv } from "./git-env.mjs";

/** The SHA a sticky review comment's hidden marker names, or null. */
export function reviewedSha(body) {
  return /<!-- reviewed-sha: ([0-9a-f]{40}) -->/.exec(body ?? "")?.[1] ?? null;
}

/**
 * Whether a previous sticky comment is a passing verdict on `fromSha`: a completed review (it
 * carries the SHA marker) whose heading is ✅. A ⚠️ "accepted by label" pass doesn't carry:
 * the label is removed on every push.
 */
export function passingVerdict(body, fromSha) {
  if (!body || reviewedSha(body) !== fromSha) return false;
  return /^### ✅ /m.test(body);
}

/**
 * Runs git in `cwd`; `git(args, input?)` returns stdout without its trailing newline. `GIT_*`
 * variables are dropped, so under a git hook it can't write to the hook's repository (AI-20).
 */
export function gitRunner(cwd) {
  return (args, input) =>
    execFileSync("git", args, {
      cwd,
      input,
      env: cleanGitEnv(),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }).replace(/\n$/, "");
}

/** Stable id of the diff from `a` to `b`, whitespace kept; "" when there is no diff. */
function diffId(git, a, b) {
  const diff = git(["diff", "--no-ext-diff", "--no-color", "--full-index", "--binary", a, b]);
  if (diff === "") return "";
  return git(["patch-id", "--verbatim"], `${diff}\n`).split(" ")[0] ?? "";
}

/**
 * Decides whether the previous verdict carries forward to `head`.
 * Returns { carry: true, from } or { carry: false, reason }.
 */
export function decide({ git, previous, head, baseRef }) {
  const from = reviewedSha(previous);
  if (!from) return { carry: false, reason: "there is no earlier review to carry forward" };
  const parents = git(["rev-list", "--parents", "-n", "1", head]).split(" ").slice(1);
  if (parents.length !== 2) {
    return { carry: false, reason: "its commit is not a merge of the base branch" };
  }
  const [first, second] = parents;
  if (first !== from) {
    return { carry: false, reason: "its merge does not sit on the reviewed commit" };
  }
  try {
    git(["merge-base", "--is-ancestor", second, `origin/${baseRef}`]);
  } catch {
    return { carry: false, reason: `it merged a commit that is not on ${baseRef}` };
  }
  if (!passingVerdict(previous, from)) {
    return { carry: false, reason: "the earlier verdict did not pass" };
  }
  const oldBase = git(["merge-base", from, second]);
  if (diffId(git, oldBase, from) !== diffId(git, second, head)) {
    return { carry: false, reason: "its merge changed the PR's own diff" };
  }
  return { carry: true, from };
}

/** The $GITHUB_OUTPUT lines for a decision. */
export function outputLines(result) {
  return result.carry
    ? ["mode=carried", `carried-from=${result.from}`]
    : [
        "mode=unavailable",
        `reason=the re-sync bot updated this PR and ${result.reason}; push a commit to get a review`,
      ];
}

function main() {
  const file = process.env.PREVIOUS_FILE ?? "";
  const previous = file && existsSync(file) ? readFileSync(file, "utf8") : "";
  let result;
  try {
    result = decide({
      git: gitRunner(process.cwd()),
      previous,
      head: process.env.HEAD_SHA ?? "",
      baseRef: process.env.BASE_REF ?? "main",
    });
  } catch (error) {
    // Fail closed, but still let the finish step post the comment.
    process.stderr.write(`review-carry: ${error.message}\n`);
    result = { carry: false, reason: "git could not compare the commits (see the run log)" };
  }
  process.stdout.write(`${outputLines(result).join("\n")}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
