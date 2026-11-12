import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "./git-env.mjs";

/**
 * AI-135: the executor tests run git for real. Run inside a git hook, they inherit the hook's
 * GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE, and a test once committed the hook repo's staged
 * changes as "AI-3: RecognisableSecretTitle". This runs those suites as a hook would, aimed at a
 * throwaway "outer" repository with staged changes, and checks nothing in it moved.
 */

const ROOT = join(import.meta.dirname, "..");
const VITEST = join(
  dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);
// Every executor suite that runs git, directly or through the code it tests.
const SUITES = [
  "scripts/executor-publish.test.mjs",
  "scripts/executor-publish-sync.test.mjs",
  "scripts/executor-sync-steps.test.mjs",
  "scripts/executor-sandbox.test.mjs",
  "scripts/executor-base-branch.test.mjs",
];

/** An outer repository like a developer's worktree: committed, identity set, changes staged. */
function outerRepo() {
  const dir = mkdtempSync(join(tmpdir(), "outer-repo-"));
  const git = (...args) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: cleanGitEnv() });
  git("init", "-q");
  git("config", "user.name", "Outer");
  git("config", "user.email", "outer@example.com");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "outer: first");
  writeFileSync(join(dir, "a.txt"), "two\n");
  writeFileSync(join(dir, "b.txt"), "new\n");
  git("add", "a.txt", "b.txt");
  writeFileSync(join(dir, "c.txt"), "untracked\n");
  return { dir, git };
}

/** HEAD, every ref, the index and the working tree's status. */
const snapshot = (git) => ({
  head: git("rev-parse", "HEAD"),
  refs: git("for-each-ref", "--format=%(refname) %(objectname)"),
  index: git("ls-files", "--stage"),
  status: git("status", "--porcelain=v1", "--untracked-files=all"),
});

describe("executor tests inside a git hook", () => {
  it("GivenAHookEnvironmentWithStagedChanges_WhenTheExecutorSuitesRun_ThenTheOuterRepoIsUnchanged", () => {
    const outer = outerRepo();
    const before = snapshot(outer.git);
    // What git exports to a hook (githooks(5)), pointed at the outer repository.
    const hookEnv = {
      ...cleanGitEnv(),
      GIT_DIR: join(outer.dir, ".git"),
      GIT_INDEX_FILE: join(outer.dir, ".git", "index"),
      GIT_WORK_TREE: outer.dir,
      GIT_PREFIX: "",
    };

    const result = spawnSync(process.execPath, [VITEST, "run", "--project", "scripts", ...SUITES], {
      cwd: ROOT,
      env: hookEnv,
      encoding: "utf8",
      timeout: 150_000,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(snapshot(outer.git)).toEqual(before);
    expect(outer.git("log", "--format=%s")).toBe("outer: first\n");
  }, 180_000);
});
