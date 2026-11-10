import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INSTALL_INPUT_GLOBS, installDrift } from "./executor-publish.mjs";

/**
 * AI-72 (ADR-0083): the sync steps of `.github/workflows/claude-executor.yml`, run as written
 * (their `run:` scripts, under the runner's `bash -eo pipefail`) against a temporary repo. The
 * dependency install runs outside the sandbox, so a sync must never reach it with install inputs
 * (manifests, lockfile, .npmrc) a PR changed: the merge step reports them, the mode step then
 * skips the install and the agent, and the install step runs only in edit mode.
 */

// Git hooks set GIT_DIR and the like for the outer repo; never let a git call here reach it.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/claude-executor.yml"), "utf8");
const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

/** A step's block (from its `- name:` line to the next step) in the workflow. */
function stepBlock(name) {
  const lines = WORKFLOW.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start < 0) throw new Error(`no step "${name}"`);
  const indent = lines[start].indexOf("-");
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end];
    if (l.trim() !== "" && l.search(/\S/) <= indent) break;
    end++;
  }
  return lines.slice(start, end);
}

/** The step's `run: |` script, dedented. */
function stepScript(name) {
  const block = stepBlock(name);
  const at = block.findIndex((l) => /^\s*run: \|\s*$/.test(l));
  const indent = block[at].search(/\S/);
  const body = [];
  for (const l of block.slice(at + 1)) {
    if (l.trim() !== "" && l.search(/\S/) <= indent) break;
    body.push(l);
  }
  const pad = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(pad)).join("\n");
}

/** Runs a step script like the runner (`bash --noprofile --norc -eo pipefail`); its outputs. */
function runStep(name, cwd, env) {
  const dir = mkdtempSync(join(tmpdir(), "sync-step-"));
  const script = join(dir, "step.sh");
  const output = join(dir, "output");
  writeFileSync(script, stepScript(name));
  writeFileSync(output, "");
  const res = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV, GITHUB_OUTPUT: output, ...env },
  });
  const outputs = Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  return { status: res.status, stdout: res.stdout + res.stderr, outputs, outputFile: output };
}

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

/** A checkout like the agent job's: the PR head detached, origin/main fetched. */
function checkout(prFiles) {
  const root = mkdtempSync(join(tmpdir(), "sync-checkout-"));
  sh(root, "init", "-q", "-b", "main");
  write(root, "package.json", '{"name":"app"}\n');
  write(root, "a.txt", "one\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "base");
  sh(root, "checkout", "-q", "-b", "pr");
  for (const [path, text] of Object.entries(prFiles)) write(root, path, text);
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "pr");
  const head = sh(root, "rev-parse", "HEAD");
  sh(root, "checkout", "-q", "main");
  write(root, "b.txt", "main\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "main moved");
  sh(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  sh(root, "checkout", "-q", "--detach", head);
  const temp = mkdtempSync(join(tmpdir(), "sync-runner-"));
  // A copy, as the runner has one: a symlink would hide the script's own path from it.
  cpSync(join(ROOT, "scripts"), join(temp, "platform", "scripts"), { recursive: true });
  return { root, head, env: { DEFAULT_BRANCH: "main", HEAD_SHA: head, RUNNER_TEMP: temp } };
}

describe("sync steps of the executor workflow", () => {
  it("GivenAPrThatChangesTheManifestAndNpmrc_WhenMerged_ThenTheDriftIsReportedAndNothingInstallsOrRuns", () => {
    const c = checkout({ "package.json": '{"name":"app","scripts":{"x":"y"}}\n', ".npmrc": "r\n" });
    const merge = runStep("Merge the default branch (sync)", c.root, c.env);
    expect(merge.status).toBe(0);
    expect(JSON.parse(merge.outputs.install_drift)).toEqual([".npmrc", "package.json"]);
    const mode = runStep("Decide the agent's mode", c.root, {
      STEP: "sync",
      INSTALL_DRIFT: merge.outputs.install_drift,
    });
    expect(mode.outputs).toEqual({ edits: "false", skip_agent: "true" });
  });

  it("GivenAPrThatChangesOnlyCode_WhenMerged_ThenTheAgentRunsInEditMode", () => {
    const c = checkout({ "src/x.ts": "export const x = 1;\n" });
    const merge = runStep("Merge the default branch (sync)", c.root, c.env);
    expect(merge.status).toBe(0);
    expect(merge.outputs.install_drift).toBeUndefined();
    expect(merge.outputs.merge_tree).toMatch(/^[0-9a-f]{40}$/);
    const mode = runStep("Decide the agent's mode", c.root, { STEP: "sync", INSTALL_DRIFT: "" });
    expect(mode.outputs).toEqual({ edits: "true", skip_agent: "false" });
  });

  it("GivenAPrHeadThatAlreadyHasMain_WhenMerged_ThenAlreadyCurrentAndNoAgent", () => {
    const c = checkout({ "src/x.ts": "1\n" });
    sh(c.root, "merge", "-q", "--no-edit", "origin/main");
    const head = sh(c.root, "rev-parse", "HEAD");
    const merge = runStep("Merge the default branch (sync)", c.root, { ...c.env, HEAD_SHA: head });
    expect(merge.outputs.already_current).toBe("true");
    const mode = runStep("Decide the agent's mode", c.root, {
      STEP: "sync",
      ALREADY_CURRENT: "true",
    });
    expect(mode.outputs).toEqual({ edits: "false", skip_agent: "true" });
  });

  it("GivenTheAgentSaysSynced_WhenTheExecutorsChecksDidntPass_ThenNoPublishAndTheOutcomeIsChecksFailed", () => {
    const report = JSON.stringify({
      status: "succeeded",
      output: { outcome: "synced", summary: "s", conflictFiles: [], reason: "", verification: [] },
    });
    const failed = runStep("Settle the sync result (sync)", tmpdir(), {
      REPORT: report,
      AGENT_SYNCED: "true",
      CHECKS_PASSED: "",
      CHECKS_PROBLEM: "the checks didn't all pass",
    });
    expect(failed.outputs.sync_publish).toBeUndefined();
    const settled = /report<<\S+\n(.*)\n/.exec(readFileSync(failed.outputFile, "utf8"))[1];
    expect(JSON.parse(settled).output).toMatchObject({
      outcome: "checks_failed",
      reason: expect.stringContaining("the checks didn't all pass"),
    });

    const passed = runStep("Settle the sync result (sync)", tmpdir(), {
      REPORT: report,
      AGENT_SYNCED: "true",
      CHECKS_PASSED: "true",
    });
    expect(passed.outputs.sync_publish).toBe("true");
  });

  it("GivenTheChecksStep_WhenRead_ThenItRunsInTheSandboxWithTheScrubAndOnlyAfterTheAgentSynced", () => {
    const block = stepBlock("Run the checks (sync)").join("\n");
    expect(block).toContain('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"');
    expect(block).toContain("--model haiku");
    const prep = stepBlock("Prepare the checks (sync)").join("\n");
    expect(prep).toContain("steps.report.outputs.agent_synced == 'true'");
  });

  it("GivenTheWorkflow_WhenRead_ThenEveryStepThatInstallsOrRunsProjectCodeIsGatedOnEditMode", () => {
    for (const name of [
      "Prepare the sandbox (build)",
      "Check the sandbox (build)",
      "Set up pnpm (build)",
      "Set up Node (build)",
      "Install dependencies (build)",
    ]) {
      const cond = stepBlock(name).find((l) => l.trim().startsWith("if:"));
      expect(cond, name).toContain("steps.mode.outputs.edits == 'true'");
    }
  });

  it("GivenPaths_WhenCheckedForInstallInputs_ThenManifestsLockfilesAndConfigMatchAnywhere", () => {
    expect(
      installDrift([
        "package.json",
        "apps/web/package.json",
        "pnpm-lock.yaml",
        ".npmrc",
        "packages/x/.npmrc",
        "pnpm-workspace.yaml",
        ".nvmrc",
        "src/index.ts",
        "docs/package.json.md",
      ]),
    ).toEqual([
      ".npmrc",
      ".nvmrc",
      "apps/web/package.json",
      "package.json",
      "packages/x/.npmrc",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ]);
    expect(INSTALL_INPUT_GLOBS).toContain("**/.pnpmfile.cjs");
  });
});
