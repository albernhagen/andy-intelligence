import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AI-106 (ADR-0096 question 1): the model credential lives in the calling repo's `agent`
 * environment, deployable from `main` only. Only the executor's `agent` job names it and reads
 * the credential; it checks the credential first, and the report carries the reason when it is
 * missing. The check's `run:` script is run as written under the runner's `bash -eo pipefail`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/claude-executor.yml"), "utf8");
const LINES = WORKFLOW.split("\n");

/** A job's lines, from its `  <name>:` line under `jobs:` to the next job. */
function jobBlock(name) {
  const jobsAt = LINES.findIndex((l) => l === "jobs:");
  const start = LINES.findIndex((l, i) => i > jobsAt && l === `  ${name}:`);
  if (start < 0) throw new Error(`no job "${name}"`);
  let end = start + 1;
  while (end < LINES.length && !/^ {2}[a-z][\w-]*:$/.test(LINES[end])) end++;
  return LINES.slice(start, end);
}

/** A step's `run: |` script inside `lines`, dedented. */
function stepScript(lines, name) {
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start < 0) throw new Error(`no step "${name}"`);
  const at = lines.findIndex((l, i) => i > start && /^\s*run: \|\s*$/.test(l));
  const indent = lines[at].search(/\S/);
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() !== "" && l.search(/\S/) <= indent) break;
    body.push(l);
  }
  const pad = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(pad)).join("\n");
}

const JOBS = ["context", "deps", "agent", "publish", "report"];

function checkCredential(env) {
  const dir = mkdtempSync(join(tmpdir(), "credential-step-"));
  const script = join(dir, "step.sh");
  const output = join(dir, "output");
  writeFileSync(script, stepScript(jobBlock("agent"), "Check the model credential"));
  writeFileSync(output, "");
  const res = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: output, ...env },
  });
  const error = readFileSync(output, "utf8").match(/^error=(.*)$/m)?.[1];
  return { status: res.status, error };
}

describe("executor credential: the agent environment (AI-106)", () => {
  it("GivenTheExecutor_WhenItsJobsAreRead_ThenOnlyTheAgentJobNamesTheAgentEnvironment", () => {
    for (const job of JOBS) {
      const named = jobBlock(job).filter((l) => /^ {4}environment:/.test(l));
      expect(named, job).toEqual(job === "agent" ? ["    environment: agent"] : []);
    }
  });

  it("GivenTheExecutor_WhenSecretsAreRead_ThenOnlyTheAgentJobReadsThem", () => {
    for (const job of JOBS) {
      const reads = jobBlock(job).filter((l) => l.includes("secrets."));
      if (job === "agent") expect(reads.length).toBeGreaterThan(0);
      else expect(reads, job).toEqual([]);
    }
  });

  it("GivenTheAgentJob_WhenItsStepsAreRead_ThenTheCredentialIsCheckedFirst", () => {
    const firstStep = jobBlock("agent").find((l) => l.trim().startsWith("- name:"));
    expect(firstStep?.trim()).toBe("- name: Check the model credential");
  });

  it.each([
    ["subscription", { HAS_OAUTH_TOKEN: "true", HAS_API_KEY: "false" }],
    ["api_key", { HAS_OAUTH_TOKEN: "false", HAS_API_KEY: "true" }],
  ])("GivenTheCredentialFor%s_WhenChecked_ThenTheJobGoesOn", (credential, has) => {
    const r = checkCredential({ CREDENTIAL: credential, ...has });
    expect(r.status).toBe(0);
    expect(r.error).toBeUndefined();
  });

  it.each([
    ["subscription", "CLAUDE_CODE_OAUTH_TOKEN"],
    ["api_key", "ANTHROPIC_API_KEY"],
  ])("GivenNoSecretFor%s_WhenChecked_ThenTheJobStopsAndSaysWhere", (credential, secret) => {
    const r = checkCredential({
      CREDENTIAL: credential,
      HAS_OAUTH_TOKEN: "false",
      HAS_API_KEY: "false",
    });
    expect(r.status).not.toBe(0);
    expect(r.error).toContain(secret);
    expect(r.error).toContain("agent environment");
  });

  it("GivenAnUnknownCredential_WhenChecked_ThenTheJobStops", () => {
    const r = checkCredential({ CREDENTIAL: "free", HAS_OAUTH_TOKEN: "true", HAS_API_KEY: "true" });
    expect(r.status).not.toBe(0);
  });

  it("GivenAMissingCredential_WhenTheReportIsBuilt_ThenItsReasonReachesTheControlPlane", () => {
    const report = jobBlock("report").join("\n");
    expect(report).toContain("CREDENTIAL_ERROR: ${{ needs.agent.outputs.credential_error }}");
    expect(report).toContain("${CREDENTIAL_ERROR:+: $CREDENTIAL_ERROR}");
    expect(jobBlock("agent").join("\n")).toContain(
      "credential_error: ${{ steps.credential.outputs.error }}",
    );
  });
});
