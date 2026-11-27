import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, WORKFLOW, runContext, stepBlock, stepScript } from "./executor-workflow-testlib.mjs";
import { cleanGitEnv } from "./git-env.mjs";

/**
 * AI-122 (ADR-0049): a night launch's story builds on `epic/<KEY>`. The context step of
 * `.github/workflows/claude-executor.yml` is run as written (`runContext`) to check the base
 * branch is validated before it becomes an output; the expressions that use it are checked as
 * text.
 */

const build = (over = {}) => ({
  runId: "run1",
  step: "build",
  model: "sonnet",
  maxTurns: 50,
  prompt: "Do the ticket.",
  ticket: { projectId: "ai", key: "AI-3", title: "A story" },
  branch: "agent/AI-3/run1",
  sync: null,
  ...over,
});

describe("executor context step: base branch (AI-122)", () => {
  it("GivenALaunchedStory_WhenTheContextIsRead_ThenItsEpicBranchIsTheBaseOutput", () => {
    const r = runContext(build({ baseBranch: "epic/AI-1" }));

    expect(r.status, r.log).toBe(0);
    expect(r.value("base_branch")).toBe("epic/AI-1");
    expect(r.value("branch")).toBe("agent/AI-3/run1");
  });

  it("GivenNoBaseBranch_WhenTheContextIsRead_ThenTheBaseOutputIsEmpty", () => {
    for (const context of [build(), build({ baseBranch: null })]) {
      const r = runContext(context);

      expect(r.status, r.log).toBe(0);
      expect(r.value("base_branch")).toBe("");
    }
  });

  it("GivenABaseThatIsNotAnEpicBranchOfTheProject_WhenTheContextIsRead_ThenTheRunStopsHere", () => {
    for (const baseBranch of [
      "main",
      "epic/BB-1",
      "epic/AI-1/../main",
      "epic/AI-1\nmain",
      "epic/AI-1;true",
      "refs/heads/epic/AI-1",
      7,
    ]) {
      const r = runContext(build({ baseBranch }));

      expect(r.status, String(baseBranch)).not.toBe(0);
      expect(r.value("error")).toContain("unexpected response shape");
      expect(r.value("base_branch")).toBeUndefined();
    }
  });

  it("GivenABaseOnAStepOtherThanBuild_WhenTheContextIsRead_ThenTheRunStopsHere", () => {
    const r = runContext(build({ step: "plan", branch: null, baseBranch: "epic/AI-1" }));

    expect(r.status).not.toBe(0);
    expect(r.value("error")).toContain("unexpected response shape");
  });

  it("GivenTheWorkflow_WhenRead_ThenTheBaseBranchIsUsedOnlyWithTheDefaultBranchAsFallback", () => {
    const checkout = stepBlock("Check out the project").join("\n");
    expect(checkout).toContain(
      "ref: ${{ needs.context.outputs.step == 'sync' && needs.context.outputs.head_sha || needs.context.outputs.verify_sha || needs.context.outputs.base_branch || github.event.repository.default_branch }}",
    );
    const publish = stepBlock("Publish the change").join("\n");
    expect(publish).toContain(
      "BASE: ${{ needs.context.outputs.base_branch || github.event.repository.default_branch }}",
    );
    expect(publish).toContain("DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}");
    // Never interpolated into a script: the value reaches `run:` only through env.
    for (const line of WORKFLOW.split("\n").filter((l) => l.includes("outputs.base_branch"))) {
      expect(line).toMatch(/^\s*(ref|BASE|base_branch|fetch-depth|if): /);
    }
  });
});

// A git hook (pre-push runs the tests) exports GIT_DIR and friends; inherited, they would point
// these temporary repos' git commands at the real one (AI-135).
const GIT_ENV = {
  ...cleanGitEnv(),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV }).trim();

/**
 * A checkout of `epic/AI-1` with `origin/main` fetched (as the full-history checkout leaves it):
 * main has a lockfile and CODEOWNERS; `onEpic` writes the epic branch's own commit.
 */
function epicCheckout(onEpic, onMainLater = null) {
  const root = mkdtempSync(join(tmpdir(), "epic-check-"));
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "package.json"), '{"name":"p"}\n');
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(root, "CODEOWNERS"), "* @andy\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "main");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "-q", "-b", "epic/AI-1");
  onEpic(root);
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", "story");
  if (onMainLater) {
    // The default branch moves on after the epic branch left it.
    git(root, "checkout", "-q", "main");
    onMainLater(root);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "main moves on");
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(root, "checkout", "-q", "epic/AI-1");
  }
  // The platform checkout the step reads its script from, untracked like in the job.
  mkdirSync(join(root, ".executor-platform"));
  cpSync(join(ROOT, "scripts"), join(root, ".executor-platform", "scripts"), { recursive: true });
  return root;
}

function runEpicCheck(cwd) {
  const res = spawnSync(
    "bash",
    [
      "--noprofile",
      "--norc",
      "-eo",
      "pipefail",
      "-c",
      stepScript("Check the epic branch against the default branch"),
    ],
    { cwd, encoding: "utf8", env: { ...GIT_ENV, DEFAULT_BRANCH: "main" } },
  );
  return { status: res.status, log: res.stdout + res.stderr };
}

describe("executor agent job: epic branch check (AI-122)", () => {
  it("GivenAnEpicBranchWithOnlyCodeChanges_WhenChecked_ThenTheJobGoesOn", () => {
    const r = runEpicCheck(
      epicCheckout((root) => writeFileSync(join(root, "story.ts"), "export const x = 1;\n")),
    );

    expect(r.status, r.log).toBe(0);
    expect(r.log).toContain("unchanged since");
  });

  it("GivenTheDefaultBranchBumpsItsLockfileAndCodeownersAfterTheEpicLeft_WhenChecked_ThenTheJobGoesOn", () => {
    const r = runEpicCheck(
      epicCheckout(
        (root) => writeFileSync(join(root, "story.ts"), "export const x = 1;\n"),
        (root) => {
          writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nbumped: true\n");
          writeFileSync(join(root, "CODEOWNERS"), "* @andy\n/infra/ @andy\n");
        },
      ),
    );

    expect(r.status, r.log).toBe(0);
  });

  it("GivenTheEpicChangedItsLockfileAndTheDefaultBranchMovedOn_WhenChecked_ThenTheJobStillStops", () => {
    const r = runEpicCheck(
      epicCheckout(
        (root) =>
          writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nepic: true\n"),
        (root) => writeFileSync(join(root, "README.md"), "moved on\n"),
      ),
    );

    expect(r.status).not.toBe(0);
    expect(r.log).toContain("no install, no agent");
  });

  it("GivenAnEpicBranchWithNoHistoryInCommonWithTheDefaultBranch_WhenChecked_ThenTheJobStops", () => {
    const root = epicCheckout(() => {});
    git(root, "checkout", "-q", "--orphan", "stray");
    git(root, "commit", "-q", "--allow-empty", "-m", "unrelated");
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(root, "checkout", "-q", "epic/AI-1");

    const r = runEpicCheck(root);

    expect(r.status).not.toBe(0);
    expect(r.log).toContain("no history");
  });

  it.each([
    ["the lockfile", "pnpm-lock.yaml", "lockfileVersion: '9.0'\nchanged: true\n"],
    ["a package manifest", "package.json", '{"name":"p","dependencies":{"x":"1"}}\n'],
    ["an npmrc", ".npmrc", "registry=https://evil.example/\n"],
    ["CODEOWNERS", "CODEOWNERS", "* @someone-else\n"],
  ])(
    "GivenAnEpicBranchThatChanges%s_WhenChecked_ThenTheJobStopsBeforeTheInstall",
    (_what, path, text) => {
      const r = runEpicCheck(epicCheckout((root) => writeFileSync(join(root, path), text)));

      expect(r.status).not.toBe(0);
      expect(r.log).toContain("no install, no agent");
    },
  );

  it("GivenTheDefaultBranchWasNotFetched_WhenChecked_ThenTheJobStops", () => {
    const root = epicCheckout(() => {});
    git(root, "update-ref", "-d", "refs/remotes/origin/main");

    const r = runEpicCheck(root);

    expect(r.status).not.toBe(0);
    expect(r.log).toContain("wasn't fetched");
  });

  it("GivenTheWorkflow_WhenRead_ThenTheCheckRunsOnlyForEpicBuildsAndBeforeTheProfileAndInstall", () => {
    const check = stepBlock("Check the epic branch against the default branch").join("\n");
    expect(check).toContain("if: needs.context.outputs.base_branch != ''");
    const order = (name) => WORKFLOW.indexOf(`- name: ${name}`);
    expect(order("Check the epic branch against the default branch")).toBeLessThan(
      order("Install the permission profile as managed settings"),
    );
    expect(order("Install the permission profile as managed settings")).toBeLessThan(
      order("Install dependencies (build)"),
    );
    expect(stepBlock("Check out the project").join("\n")).toContain(
      "fetch-depth: ${{ fromJSON((needs.context.outputs.step == 'sync' || needs.context.outputs.base_branch != '') && '0' || '1') }}",
    );
  });
});
