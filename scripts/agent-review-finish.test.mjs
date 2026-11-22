import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "./git-env.mjs";
import { evaluate } from "./review-gate.mjs";

// Runs the "Gate and comment" step of platform/actions/agent-review-finish as written, under the
// runner's `bash -eo pipefail`, with a fake `gh` serving this role's sticky comment (ADR-0139).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACTION_DIR = join(ROOT, "platform/actions/agent-review-finish");
const ACTION = readFileSync(join(ACTION_DIR, "action.yml"), "utf8");

/** The step's `run: |` script, dedented. */
function runScript(name) {
  const lines = ACTION.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  const run = lines.findIndex((l, i) => i > start && l.trim() === "run: |");
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && !line.startsWith("        ")) break;
    body.push(line.slice(8));
  }
  return body.join("\n");
}

const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
args="$*"
if [[ "$args" == *"-X PATCH"* ]]; then
  for a in "$@"; do [[ "$a" == body=@* ]] && cp "\${a#body=@}" "$FAKE/patched.md"; done
elif [[ "$args" == *"issues/comments/"* ]]; then
  cat "$FAKE/previous.md"
elif [[ "$args" == *"--paginate"* ]]; then
  cat "$FAKE/id"
else
  for a in "$@"; do [[ "$a" == body=@* ]] && cp "\${a#body=@}" "$FAKE/posted.md"; done
fi
`;

const FROM = "a".repeat(40);
const HEAD = "b".repeat(40);
const MARKER = "<!-- adversarial-review -->";
const passed = (sha) =>
  evaluate({
    role: "adversarial",
    mode: "review",
    accepted: false,
    sha,
    findings: JSON.stringify({ summary: "ok", findings: [] }),
  }).body;

function finish({ mode, outcome = "skipped", previous = "", carriedFrom = "" }) {
  const fake = mkdtempSync(join(tmpdir(), "review-finish-"));
  writeFileSync(join(fake, "gh"), FAKE_GH);
  chmodSync(join(fake, "gh"), 0o755);
  writeFileSync(join(fake, "id"), previous ? "123\n" : "");
  writeFileSync(join(fake, "previous.md"), previous);
  const result = spawnSync("bash", ["-eo", "pipefail", "-c", runScript("Gate and comment")], {
    encoding: "utf8",
    env: {
      ...cleanGitEnv(),
      PATH: `${fake}:${process.env.PATH}`,
      FAKE: fake,
      RUNNER_TEMP: fake,
      GITHUB_ACTION_PATH: ACTION_DIR,
      GITHUB_REPOSITORY: "o/r",
      GH_TOKEN: "x",
      PR: "7",
      ROLE: "adversarial",
      MARKER,
      MODE_IN: mode,
      REASON_IN: "",
      OUTCOME: outcome,
      ACCEPTED: "false",
      FINDINGS: "",
      EXECUTION_FILE: "",
      SHA: HEAD,
      CARRIED_FROM: carriedFrom,
    },
  });
  const comment = ["patched.md", "posted.md"]
    .map((f) => join(fake, f))
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f, "utf8"))[0];
  return { status: result.status, comment: comment ?? "", stderr: result.stderr };
}

describe("agent-review-finish: Gate and comment", () => {
  it("GivenACarriedPassingVerdict_WhenFinished_ThenTheCheckPassesAndTheCommentMovesToTheHead", () => {
    const result = finish({ mode: "carried", previous: passed(FROM), carriedFrom: FROM });
    expect(result.status).toBe(0);
    expect(result.comment).toContain(`<!-- reviewed-sha: ${HEAD} -->`);
    expect(result.comment).toContain(`Carried forward from ${FROM} to ${HEAD}`);
  });

  it("GivenACarriedVerdictOnAnotherCommit_WhenFinished_ThenTheCheckFailsAsNotReviewed", () => {
    const result = finish({ mode: "carried", previous: passed(HEAD), carriedFrom: FROM });
    expect(result.status).toBe(1);
    expect(result.comment).toContain("not reviewed");
  });

  it("GivenCarriedModeWithNoEarlierComment_WhenFinished_ThenTheCheckFails", () => {
    const result = finish({ mode: "carried", carriedFrom: FROM });
    expect(result.status).toBe(1);
    expect(result.comment).toContain("not reviewed");
  });

  it("GivenAnAgentRunThatFailed_WhenFinished_ThenTheCheckFails", () => {
    const result = finish({ mode: "review", outcome: "failure" });
    expect(result.status).toBe(1);
    expect(result.comment).toContain("the agent run failed");
  });

  it("GivenASkipByDesign_WhenFinished_ThenTheCheckPasses", () => {
    expect(finish({ mode: "skipped" }).status).toBe(0);
  });
});
