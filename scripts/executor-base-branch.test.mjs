import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AI-122 (ADR-0049): a night launch's story builds on `epic/<KEY>`. The context step of
 * `.github/workflows/claude-executor.yml` is run as written (its `run:` script, under the
 * runner's `bash -eo pipefail`) with a fake `curl` serving the control plane's context, to check
 * the base branch is validated before it becomes an output; the expressions that use it are
 * checked as text.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/claude-executor.yml"), "utf8");

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

// The OIDC call gets a token whose payload is `{}`; the context call gets $CONTEXT_JSON.
const FAKE_CURL = `#!/usr/bin/env bash
out=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; esac
  shift
done
if [ -n "$out" ]; then printf '%s' "$CONTEXT_JSON" > "$out"; printf 200; else printf '{"value":"h.e30.s"}'; fi
`;

function runContext(context) {
  const dir = mkdtempSync(join(tmpdir(), "context-step-"));
  const bin = join(dir, "bin");
  spawnSync("mkdir", [bin]);
  writeFileSync(join(bin, "curl"), FAKE_CURL);
  chmodSync(join(bin, "curl"), 0o755);
  const script = join(dir, "step.sh");
  const output = join(dir, "output");
  writeFileSync(script, stepScript("Validate inputs and fetch the run context"));
  writeFileSync(output, "");
  const res = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: dir,
      RUN_ID: "run1",
      CREDENTIAL: "subscription",
      HAS_OAUTH_TOKEN: "true",
      HAS_API_KEY: "false",
      MAX_TURNS_CAP: "200",
      MAX_PROMPT_CHARS: "200000",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "req",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example/token?x=1",
      CONTROL_PLANE_URL: "https://ai.andybernhagen.com",
      CONTEXT_JSON: JSON.stringify(context),
    },
  });
  const text = readFileSync(output, "utf8");
  const value = (key) => text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];
  return { status: res.status, log: res.stdout + res.stderr, value };
}

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
      "ref: ${{ needs.context.outputs.step == 'sync' && needs.context.outputs.head_sha || needs.context.outputs.base_branch || github.event.repository.default_branch }}",
    );
    const publish = stepBlock("Publish the change").join("\n");
    expect(publish).toContain(
      "BASE: ${{ needs.context.outputs.base_branch || github.event.repository.default_branch }}",
    );
    expect(publish).toContain("DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}");
    // Never interpolated into a script: the value reaches `run:` only through env.
    for (const line of WORKFLOW.split("\n").filter((l) => l.includes("outputs.base_branch"))) {
      expect(line).toMatch(/^\s*(ref|BASE|base_branch): /);
    }
  });
});
