import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test helpers for `.github/workflows/claude-executor.yml`: a step's block and `run:` script as
 * written, and the context step run under the runner's `bash -eo pipefail` with a fake `curl`
 * serving the control plane's context.
 */

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/claude-executor.yml"), "utf8");

/** A step's block (from its `- name:` line to the next step) in the workflow. */
export function stepBlock(name) {
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
export function stepScript(name) {
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

export function runContext(context) {
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
