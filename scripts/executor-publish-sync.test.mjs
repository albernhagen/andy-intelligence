import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "./executor-profile.mjs";
import { PublishRefused, gitRunner, publishSync, unresolvedFiles } from "./executor-publish.mjs";

/**
 * The sync run's publish (AI-72, ADR-0083) against a real git repository: the PR branch and main
 * both edit `a.txt`, the executor's merge leaves markers, the agent's patch resolves them, and
 * the publish job commits the merge with both parents. Only `push` is intercepted.
 */

// Git hooks run tests with GIT_DIR, GIT_INDEX_FILE and the like set for the outer repo: every git
// call here must act on its own temporary repo only, so none of them is inherited.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}

const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const sh = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const write = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

/** A repo where `pr` and `main` diverged; `conflict` makes both edit the same line. */
function repo({ conflict = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sync-publish-"));
  sh(root, "init", "-q", "-b", "main");
  write(root, "a.txt", "one\ntwo\nthree\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "base");
  sh(root, "checkout", "-q", "-b", "pr");
  write(root, "a.txt", "one\nTWO from the PR\nthree\n");
  write(root, "pr.txt", "pr\n");
  sh(root, "commit", "-q", "-am", "pr");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "pr file");
  const head = sh(root, "rev-parse", "HEAD");
  sh(root, "checkout", "-q", "main");
  write(root, "a.txt", conflict ? "one\ntwo from main\nthree\n" : "one\ntwo\nthree\nfour\n");
  sh(root, "commit", "-q", "-am", "main");
  const main = sh(root, "rev-parse", "HEAD");
  sh(root, "checkout", "-q", head);
  return { root, head, main };
}

/** What the agent job does before the agent: the merge, staged, as the tree it starts from. */
function mergeTree(root, main) {
  try {
    sh(root, "merge", "--no-ff", "--no-commit", main);
  } catch {
    // conflicts
  }
  sh(root, "add", "-A");
  const tree = sh(root, "write-tree");
  sh(root, "merge", "--abort");
  return tree;
}

/** The agent's resolution as a patch over the merge tree, written in a scratch clone. */
function resolution(root, main, files) {
  const work = mkdtempSync(join(tmpdir(), "sync-agent-"));
  sh(root, "worktree", "add", "-q", "--detach", work, "HEAD");
  try {
    sh(work, "merge", "--no-ff", "--no-commit", main);
  } catch {
    // conflicts
  }
  sh(work, "add", "-A");
  const base = sh(work, "write-tree");
  for (const [path, text] of Object.entries(files)) write(work, path, text);
  sh(work, "add", "-A");
  // Outside the worktree (so `add -A` never sees it) and in a directory of its own: a name in the
  // shared temp dir could collide with another run's.
  const patch = join(mkdtempSync(join(tmpdir(), "sync-patch-")), "change.patch");
  writeFileSync(patch, execFileSync("git", ["diff", "--cached", "--binary", base], { cwd: work }));
  return patch;
}

/** publishSync with `push` intercepted; `after(args)` runs after each other git call. */
function harness(root, env, after = () => {}) {
  const real = gitRunner(root);
  const pushes = [];
  const git = (args, extra = {}) => {
    if (args[0] === "push") {
      pushes.push({ args, env: extra });
      return "";
    }
    const out = real(args, extra);
    after(args);
    return out;
  };
  const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });
  const fetch = async (url) =>
    String(url).includes("/github/token") ? reply({ token: "ghs_secret" }) : reply({ value: "o" });
  const outputs = {};
  const lines = [];
  const run = () =>
    publishSync({
      env: {
        PROFILE: DEFAULT_PROFILE,
        CODEOWNERS: "",
        RUN_ID: "sync1",
        BRANCH: "agent/AI-3/build1",
        REPO: "albernhagen/andy-intelligence",
        CONTROL_PLANE_URL: "https://ai.andybernhagen.com",
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example/token?x=1",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "req",
        // As on a runner: a temp dir per job, so the scratch index is this test's alone (AI-78).
        RUNNER_TEMP: mkdtempSync(join(tmpdir(), "sync-runner-")),
        ...env,
      },
      git,
      fetch,
      emit: (l) => lines.push(l),
      output: (k, v) => (outputs[k] = v),
    });
  return { pushes, outputs, lines, run };
}

describe("sync publish", () => {
  it("GivenAConflictTheAgentResolved_WhenPublished_ThenTheMergeIsPushedWithBothParentsAndNoMarkers", async () => {
    const { root, head, main } = repo();
    const tree = mergeTree(root, main);
    const patch = resolution(root, main, { "a.txt": "one\nTWO from the PR and main\nthree\n" });
    const h = harness(root, { PATCH: patch, HEAD_SHA: head, MAIN_SHA: main, MERGE_TREE: tree });
    const result = await h.run();
    expect(sh(root, "rev-list", "--parents", "-n", "1", result.headSha).split(" ")).toEqual([
      result.headSha,
      head,
      main,
    ]);
    expect(sh(root, "show", `${result.headSha}:a.txt`)).toBe(
      "one\nTWO from the PR and main\nthree",
    );
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].args.at(-1)).toBe(`${result.headSha}:refs/heads/agent/AI-3/build1`);
    expect(h.pushes[0].args).not.toContain("--force");
    expect(h.outputs).toEqual({
      branch: "agent/AI-3/build1",
      head_sha: result.headSha,
      tooling_files: "[]",
    });
  });

  it("GivenACleanMergeAndNoPatch_WhenPublished_ThenTheMergeIsPushed", async () => {
    const { root, head, main } = repo({ conflict: false });
    const tree = mergeTree(root, main);
    const h = harness(root, { HEAD_SHA: head, MAIN_SHA: main, MERGE_TREE: tree });
    const result = await h.run();
    expect(sh(root, "show", `${result.headSha}:a.txt`)).toBe("one\nTWO from the PR\nthree\nfour");
    expect(h.pushes).toHaveLength(1);
  });

  it("GivenConflictMarkersLeft_WhenPublished_ThenItIsRefusedAndNothingIsPushed", async () => {
    const { root, head, main } = repo();
    const tree = mergeTree(root, main);
    const h = harness(root, { HEAD_SHA: head, MAIN_SHA: main, MERGE_TREE: tree });
    await expect(h.run()).rejects.toThrow(/a\.txt: conflict markers left/);
    expect(h.pushes).toEqual([]);
  });

  it("GivenAResolutionThatEditsAWorkflow_WhenPublished_ThenItIsRefused", async () => {
    const { root, head, main } = repo();
    const tree = mergeTree(root, main);
    const patch = resolution(root, main, {
      "a.txt": "one\nresolved\nthree\n",
      ".github/workflows/x.yml": "on: push\n",
    });
    const h = harness(root, { PATCH: patch, HEAD_SHA: head, MAIN_SHA: main, MERGE_TREE: tree });
    await expect(h.run()).rejects.toBeInstanceOf(PublishRefused);
    expect(h.pushes).toEqual([]);
    // Refused before anything was applied: the checkout and its index hold the merge only.
    expect(existsSync(join(root, ".github/workflows/x.yml"))).toBe(false);
    expect(sh(root, "diff", "--cached", "--name-only", "--", ".github")).toBe("");
  });

  it("GivenAResolutionThatTouchesADependencyFile_WhenPublished_ThenItIsPushedAndFlagged", async () => {
    const { root, head, main } = repo();
    const tree = mergeTree(root, main);
    const patch = resolution(root, main, {
      "a.txt": "one\nresolved\nthree\n",
      "package.json": '{"name":"x"}\n',
    });
    const h = harness(root, { PATCH: patch, HEAD_SHA: head, MAIN_SHA: main, MERGE_TREE: tree });
    const result = await h.run();
    expect(result.tooling).toEqual(["package.json"]);
    expect(h.outputs.tooling_files).toBe('["package.json"]');
  });

  it("GivenAnotherRunResettingTheSharedTempIndex_WhenPublished_ThenThisPublishIsUnaffected", async () => {
    // AI-78: another run of this file (a second worktree's pre-push hook) used the same scratch
    // index path, because the harness left RUNNER_TEMP unset and RUN_ID fixed. Its `read-tree` of
    // the conflicted merge landed between this publish's `apply --cached` and its marker check.
    // Here that other run is played at exactly that moment, on the shared temp dir's path; with
    // RUNNER_TEMP per test, as on a runner, this publish's index is elsewhere and stays intact.
    const { root, head, main } = repo();
    const tree = mergeTree(root, main);
    const patch = resolution(root, main, { "a.txt": "one\nresolved\nthree\n" });
    // Unique per invocation so concurrent copies of this file don't race on the lock here.
    const runId = `sync-${randomUUID()}`;
    const shared = join(tmpdir(), `sync-check-${runId}.index`);
    const h = harness(
      root,
      { RUN_ID: runId, PATCH: patch, HEAD_SHA: head, MAIN_SHA: main, MERGE_TREE: tree },
      (args) => {
        if (args[0] === "apply" && args[1] === "--cached") {
          gitRunner(root)(["read-tree", tree], { GIT_INDEX_FILE: shared });
        }
      },
    );
    try {
      const result = await h.run();
      expect(sh(root, "show", `${result.headSha}:a.txt`)).toBe("one\nresolved\nthree");
    } finally {
      rmSync(shared, { force: true });
    }
  });

  it("GivenAMergeTreeThatDoesntMatch_WhenPublished_ThenItIsRefused", async () => {
    const { root, head, main } = repo();
    const h = harness(root, {
      HEAD_SHA: head,
      MAIN_SHA: main,
      MERGE_TREE: "0".repeat(40),
    });
    await expect(h.run()).rejects.toThrow(/didn't reproduce/);
    expect(h.pushes).toEqual([]);
  });

  it("GivenACheckoutAtAnotherCommit_WhenPublished_ThenItIsRefusedBeforeMerging", async () => {
    const { root, main } = repo();
    const h = harness(root, { HEAD_SHA: main, MAIN_SHA: main, MERGE_TREE: "1".repeat(40) });
    await expect(h.run()).rejects.toThrow(/isn't the PR head/);
  });

  it("GivenBadInputs_WhenPublished_ThenItIsRefusedBeforeGitRuns", async () => {
    const { root, head, main } = repo();
    const h = harness(root, { BRANCH: "main", HEAD_SHA: head, MAIN_SHA: main, MERGE_TREE: "x" });
    await expect(h.run()).rejects.toThrow(/unexpected branch name; unexpected MERGE_TREE/);
  });

  it("GivenStagedTexts_WhenCheckedForMarkers_ThenOnlyLineStartMarkersCount", () => {
    const texts = {
      a: "x\n<<<<<<< HEAD\ny\n=======\nz\n>>>>>>> abc\n",
      b: "Title\n=======\n",
      c: "code with <<<<<<< inside a line\n",
    };
    expect(unresolvedFiles(["a", "b", "c", "gone"], (p) => texts[p] ?? null)).toEqual(["a"]);
    // The real file is read as text.
    expect(readFileSync(DEFAULT_PROFILE, "utf8").length).toBeGreaterThan(0);
  });
});
