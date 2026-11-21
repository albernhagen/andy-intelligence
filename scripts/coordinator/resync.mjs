#!/usr/bin/env node
// Mechanical re-sync for a coordinator acting under ADR-0120 (AI-149; runbook
// `coordinating-sessions.md` §6). CHANGES REMOTE STATE: pushes a merge commit to the PR's branch.
// Not for build agents.
//
// Merges origin/main into the PR's branch in a scratch worktree (the worker's own worktree is
// never touched). A conflict is resolved only in a Markdown file where both sides purely added
// lines at the same place (diff3 base empty): both additions are kept, the branch's first.
// Anything else aborts and lists the files for the worker. Then it installs (no lifecycle
// scripts) and runs main's copy of the context-budget check with no tokens in the environment,
// and pushes without force through the pre-push hook, also with no tokens in its environment.
// The hook runs the branch's typecheck and tests as this user, as the worker's own push does:
// that code can still reach the keychain's GitHub login (residual risk, docs/security). If the
// worker pushed meanwhile, the push is refused.
//
// Usage: node scripts/coordinator/resync.mjs <PR> [--dry-run] [--keep]
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { cleanGitEnv } from "../git-env.mjs";
import { ghJson, sh } from "./lib.mjs";

const MARK = { ours: "<<<<<<<", base: "|||||||", split: "=======", theirs: ">>>>>>>" };
const isMark = (line, mark) => line === mark || line.startsWith(`${mark} `);

/**
 * Resolves diff3 conflict hunks where both sides only added lines (empty base).
 * @returns {{ ok: true, text: string, hunks: number } | { ok: false, reason: string }}
 */
export function resolveAddOnly(text) {
  const out = [];
  let hunk = null;
  let hunks = 0;
  for (const line of text.split("\n")) {
    if (isMark(line, MARK.ours)) {
      if (hunk) return { ok: false, reason: "nested conflict markers" };
      hunk = { part: "ours", ours: [], base: null, theirs: [] };
    } else if (hunk && isMark(line, MARK.base) && hunk.part === "ours") {
      hunk.part = "base";
      hunk.base = [];
    } else if (hunk && line === MARK.split && hunk.part !== "theirs") {
      if (hunk.base === null) return { ok: false, reason: "no merge base in hunk (not diff3)" };
      hunk.part = "theirs";
    } else if (hunk && isMark(line, MARK.theirs) && hunk.part === "theirs") {
      if (hunk.base.length > 0) return { ok: false, reason: "a side changed or removed lines" };
      out.push(...hunk.ours, ...hunk.theirs);
      hunk = null;
      hunks += 1;
    } else if (hunk) {
      hunk[hunk.part].push(line);
    } else {
      out.push(line);
    }
  }
  if (hunk) return { ok: false, reason: "unterminated conflict" };
  if (hunks === 0) return { ok: false, reason: "no conflict hunks" };
  return { ok: true, text: out.join("\n"), hunks };
}

/** Auto-resolution is for docs only: two code additions can collide (a duplicate import). */
export const RESOLVABLE = /\.md$/;

/**
 * The branch's tree is untrusted. Checks run with no token in their environment; install skips
 * lifecycle scripts (the hook needs node_modules, not builds); the budget check is main's copy.
 */
function defaultChecks(trustedBudgetScript) {
  return [
    ["pnpm", ["install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"]],
    ["node", [trustedBudgetScript, "."]],
  ];
}

/** Drops credentials from an environment (gh, GitHub, cloud and API tokens). */
export function scrubbedEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        !/^(GH_|GITHUB_|GOOGLE_|CLOUDSDK_|AWS_)|TOKEN|SECRET|PASSWORD|CREDENTIAL|_KEY$/i.test(key),
    ),
  );
}

/**
 * Merges origin/main into `branch` in a scratch worktree of `repo` and pushes it.
 * @returns {{ ok: boolean, summary: string, files?: string[], resolved?: string[] }}
 */
export function resyncBranch({
  repo,
  branch,
  run = sh,
  checks,
  dryRun = false,
  keep = false,
  scratch,
}) {
  const env = cleanGitEnv();
  const git = (cwd, ...args) => run("git", args, { cwd, env });
  const must = (r, what) => {
    if (r.status !== 0) throw new Error(`${what}: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout;
  };
  // A failed fetch is never "synced": every step below needs fresh refs.
  must(
    git(repo, "fetch", "origin", "main", `+refs/heads/${branch}:refs/remotes/origin/${branch}`),
    "fetch failed",
  );
  const dir = scratch ?? mkdtempSync(join(tmpdir(), "resync-"));
  must(git(repo, "worktree", "add", "--detach", dir, `origin/${branch}`), "worktree add failed");
  try {
    const containsMain = git(dir, "merge-base", "--is-ancestor", "origin/main", "HEAD");
    if (containsMain.status === 0)
      return { ok: true, summary: "already contains main; nothing to do" };
    const merged = git(dir, "-c", "merge.conflictStyle=diff3", "merge", "--no-edit", "origin/main");
    const resolved = [];
    if (merged.status !== 0) {
      const status = must(git(dir, "status", "--porcelain=v1"), "status failed");
      const unmerged = status
        .split("\n")
        .filter((l) => /^(DD|AU|UD|UA|DU|AA|UU) /.test(l))
        .map((l) => ({ code: l.slice(0, 2), file: l.slice(3) }));
      if (unmerged.length === 0) throw new Error(`merge failed: ${merged.stderr.trim()}`);
      const refused = [];
      for (const { code, file } of unmerged) {
        const fixed =
          code !== "UU"
            ? { ok: false, reason: `conflict type ${code}` }
            : !RESOLVABLE.test(file)
              ? { ok: false, reason: "not a Markdown file" }
              : resolveAddOnly(readFileSync(join(dir, file), "utf8"));
        if (!fixed.ok) refused.push(`${file} (${fixed.reason})`);
        else {
          writeFileSync(join(dir, file), fixed.text);
          resolved.push(file);
        }
      }
      if (refused.length > 0) {
        git(dir, "merge", "--abort");
        return {
          ok: false,
          summary: `needs the worker: ${refused.join("; ")}`,
          files: unmerged.map((u) => u.file),
        };
      }
      must(git(dir, "add", "--", ...resolved), "add failed");
      must(git(dir, "commit", "--no-edit"), "commit failed");
    }
    let steps = checks;
    if (!steps) {
      const trusted = join(mkdtempSync(join(tmpdir(), "resync-budget-")), "context-budget.mjs");
      writeFileSync(
        trusted,
        must(
          git(repo, "show", "origin/main:scripts/context-budget.mjs"),
          "read main's budget script",
        ),
      );
      steps = defaultChecks(trusted);
    }
    for (const [cmd, args] of steps) {
      const r = run(cmd, args, { cwd: dir, env: scrubbedEnv(env) });
      if (r.status !== 0) {
        return {
          ok: false,
          summary: `${cmd} ${args.join(" ")} failed; not pushed:\n${(r.stdout + r.stderr).trim().slice(-2000)}`,
          resolved,
        };
      }
    }
    const what = resolved.length
      ? `merged main, resolved add-only conflicts in ${resolved.join(", ")}`
      : "merged main cleanly";
    if (dryRun) return { ok: true, summary: `${what}; dry run, not pushed`, resolved };
    // No force: if the worker pushed since the fetch, this is refused and nothing is lost.
    // The hook runs the branch's code: no tokens in its environment. git authenticates through
    // its credential helper (keychain), which code running as this user can still reach.
    const pushed = run("git", ["push", "origin", `HEAD:refs/heads/${branch}`], {
      cwd: dir,
      env: scrubbedEnv(env),
    });
    if (pushed.status !== 0) {
      return {
        ok: false,
        summary: `push refused (worker pushed meanwhile, or the hook failed):\n${pushed.stderr.trim().slice(-2000)}`,
        resolved,
      };
    }
    return {
      ok: true,
      summary: `${what}; pushed ${must(git(dir, "rev-parse", "--short", "HEAD"), "rev-parse").trim()}`,
      resolved,
    };
  } finally {
    if (!keep) git(repo, "worktree", "remove", "--force", dir);
  }
}

const HELP = `Usage: resync.mjs <PR> [--dry-run] [--keep]

CHANGES REMOTE STATE: pushes a merge of origin/main to the PR's branch (no force).
For a coordinator acting under ADR-0120 only, never for build agents.
Resolves a conflict only in Markdown files where both sides purely added lines; otherwise
aborts and lists the files for the worker. Runs main's context-budget check and the pre-push
hook (the branch's own typecheck and tests) before pushing, all with no tokens in the
environment. That code still runs as you: it can reach your keychain's GitHub login.
--dry-run merges and checks without pushing; --keep leaves the scratch worktree.
`;

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean" },
      keep: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length !== 1) {
    process.stdout.write(HELP);
    return values.help ? 0 : 2;
  }
  const pr = ghJson(sh, [
    "pr",
    "view",
    positionals[0],
    "--json",
    "headRefName,isCrossRepository,state",
  ]);
  if (pr.state !== "OPEN" || pr.isCrossRepository) {
    process.stderr.write(`#${positionals[0]}: only open PRs from this repo (state ${pr.state})\n`);
    return 1;
  }
  const result = resyncBranch({
    repo: process.cwd(),
    branch: pr.headRefName,
    dryRun: values["dry-run"],
    keep: values.keep,
  });
  process.stdout.write(`#${positionals[0]} ${pr.headRefName}: ${result.summary}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
