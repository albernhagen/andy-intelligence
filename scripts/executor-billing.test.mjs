import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AI-260: M10.13: the API-key Claude provider. The context step of
 * `.github/workflows/claude-executor.yml` is run as written with a fake `curl` serving the run's
 * context: a pay_per_use run must come with the API key credential and a budget, a subscription
 * run with the subscription credential and none. The expressions that pass the budget to Claude
 * Code are checked as text.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/claude-executor.yml"), "utf8");
const CONTEXT_STEP = "Validate inputs and fetch the run context";

/** A step's block (from its `- name:` line to the next step) in the workflow. */
function stepBlock(name) {
  const lines = WORKFLOW.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start < 0) throw new Error(`no step "${name}"`);
  const indent = lines[start].indexOf("-");
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === "" || lines[end].search(/\S/) > indent)) {
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

const FAKE_CURL = `#!/usr/bin/env bash
out=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; esac
  shift
done
if [ -n "$out" ]; then printf '%s' "$CONTEXT_JSON" > "$out"; printf 200; else printf '{"value":"h.e30.s"}'; fi
`;

function runContext(context, { credential, hasOauth = true, hasKey = true }) {
  const dir = mkdtempSync(join(tmpdir(), "billing-step-"));
  const bin = join(dir, "bin");
  spawnSync("mkdir", [bin]);
  writeFileSync(join(bin, "curl"), FAKE_CURL);
  chmodSync(join(bin, "curl"), 0o755);
  const script = join(dir, "step.sh");
  const output = join(dir, "output");
  writeFileSync(script, stepScript(CONTEXT_STEP));
  writeFileSync(output, "");
  const res = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: dir,
      RUN_ID: "run1",
      CREDENTIAL: credential,
      HAS_OAUTH_TOKEN: String(hasOauth),
      HAS_API_KEY: String(hasKey),
      MAX_TURNS_CAP: "200",
      MAX_BUDGET_USD_CAP: "50",
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

const refine = (over = {}) => ({
  runId: "run1",
  step: "refine",
  model: "opus",
  maxTurns: 30,
  prompt: "Refine the ticket.",
  ticket: { projectId: "ai", key: "AI-3", title: "A story" },
  branch: null,
  sync: null,
  ...over,
});
const paid = (over = {}) => refine({ billingType: "pay_per_use", maxBudgetUsd: 2, ...over });

describe("executor context step: billing and budget (AI-260)", () => {
  it("GivenAPayPerUseRunOnTheApiKey_WhenTheContextIsRead_ThenItsBudgetIsAnOutput", () => {
    const r = runContext(paid({ maxBudgetUsd: 1.5 }), { credential: "api_key" });
    expect(r.status, r.log).toBe(0);
    expect(r.value("max_budget_usd")).toBe("1.5");
  });

  it("GivenAPayPerUseRun_WhenDispatchedWithTheSubscriptionCredential_ThenItStopsBeforeTheAgent", () => {
    const r = runContext(paid(), { credential: "subscription" });
    expect(r.status).not.toBe(0);
    expect(r.value("error")).toContain("bills pay_per_use");
    expect(r.value("max_budget_usd")).toBeUndefined();
  });

  it("GivenASubscriptionRun_WhenDispatchedWithTheApiKey_ThenItStopsBeforeTheAgent", () => {
    const r = runContext(refine(), { credential: "api_key" });
    expect(r.status).not.toBe(0);
    expect(r.value("error")).toContain("bills subscription");
  });

  it("GivenASubscriptionRun_WhenTheContextIsRead_ThenThereIsNoBudget", () => {
    for (const context of [refine(), refine({ billingType: "subscription", maxBudgetUsd: null })]) {
      const r = runContext(context, { credential: "subscription" });
      expect(r.status, r.log).toBe(0);
      expect(r.value("max_budget_usd")).toBe("");
    }
  });

  it("GivenAPayPerUseRun_WhenTheApiKeySecretIsMissing_ThenItStopsBeforeTheContextIsRead", () => {
    const r = runContext(paid(), { credential: "api_key", hasKey: false });
    expect(r.status).not.toBe(0);
    expect(r.value("error")).toContain("ANTHROPIC_API_KEY is empty");
  });

  it("GivenAPayPerUseRunWithoutAValidBudget_WhenTheContextIsRead_ThenItStops", () => {
    for (const maxBudgetUsd of [null, 0, -1, 51, "2", 1e-7]) {
      const r = runContext(paid({ maxBudgetUsd }), { credential: "api_key" });
      expect(r.status, String(maxBudgetUsd)).not.toBe(0);
      expect(r.value("max_budget_usd")).toBeUndefined();
    }
  });

  it("GivenASubscriptionRunWithABudget_WhenTheContextIsRead_ThenItStops", () => {
    const r = runContext(refine({ maxBudgetUsd: 2 }), { credential: "subscription" });
    expect(r.status).not.toBe(0);
  });

  it("GivenAnUnknownBillingType_WhenTheContextIsRead_ThenItStops", () => {
    const r = runContext(refine({ billingType: "free" }), { credential: "subscription" });
    expect(r.status).not.toBe(0);
    expect(r.value("error")).toContain("unexpected response shape");
  });
});

describe("executor agent steps: the budget reaches Claude Code (AI-260)", () => {
  it("GivenTheAgentStep_WhenItsArgsAreRead_ThenTheBudgetFlagComesFromTheValidatedContext", () => {
    const block = stepBlock("Claude Code").join("\n");
    expect(block).toContain(
      "${{ needs.context.outputs.max_budget_usd != '' && format('--max-budget-usd {0}', needs.context.outputs.max_budget_usd) || '' }}",
    );
  });

  it.each(["Check the sandbox (build)", "Run the checks (sync)"])(
    "GivenTheHelperCall%s_WhenOnTheApiKey_ThenItHasItsOwnSmallBudget",
    (name) => {
      expect(stepBlock(name).join("\n")).toContain(
        "${{ inputs.credential == 'api_key' && '--max-budget-usd 0.25' || '' }}",
      );
    },
  );

  it("GivenEveryClaudeCodeCall_WhenItsCredentialsAreRead_ThenTheApiKeyIsUsedOnlyForApiKeyRuns", () => {
    const keys = WORKFLOW.split("\n").filter((l) => l.includes("anthropic_api_key:"));
    expect(keys.length).toBeGreaterThan(0);
    for (const l of keys) {
      expect(l.trim()).toBe(
        "anthropic_api_key: ${{ inputs.credential == 'api_key' && secrets.ANTHROPIC_API_KEY || '' }}",
      );
    }
  });
});
