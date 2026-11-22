import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, runScript } from "./agent-review-testlib.mjs";
import { cleanGitEnv } from "./git-env.mjs";

// Runs the "Decide mode" step of platform/actions/agent-review-prepare as written (ADR-0141): the
// agent App may start a review only on its own agent PRs.
const ACTION_DIR = join(ROOT, "platform/actions/agent-review-prepare");
const APP = "andy-intelligence-control[bot]";

function decide({ actor, headRef, agentBot = APP, prefix = "agent/" }) {
  const dir = mkdtempSync(join(tmpdir(), "review-prepare-"));
  const output = join(dir, "output");
  writeFileSync(output, "");
  const result = spawnSync(
    "bash",
    ["-eo", "pipefail", "-c", runScript(ACTION_DIR, "Decide mode")],
    {
      encoding: "utf8",
      env: {
        ...cleanGitEnv(),
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: "o/r",
        ACTION: "synchronize",
        LABELS: "[]",
        HEAD_REPO: "o/r",
        DRAFT: "false",
        ACTOR: actor,
        HEAD_REF: headRef,
        HAS_TOKEN: "true",
        LABEL: "review-accepted",
        AGENT_BOT: agentBot,
        AGENT_PREFIX: prefix,
      },
    },
  );
  expect(result.status).toBe(0);
  return Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

describe("agent-review-prepare: Decide mode, agent PRs", () => {
  it("GivenTheAppPushingToAnAgentBranch_WhenDecided_ThenTheAppIsAllowed", () => {
    const out = decide({ actor: APP, headRef: "agent/AI-59/HoSB8oqkM4" });
    expect(out).toMatchObject({ mode: "review", "agent-pr": "true", "allowed-bots": APP });
  });

  it("GivenTheAppPushingToAnotherBranch_WhenDecided_ThenNoBotIsAllowed", () => {
    for (const headRef of [
      "m4.346/review-resync-verdict",
      "agentx/AI-1",
      "agent",
      "x/agent/AI-1",
    ]) {
      expect(decide({ actor: APP, headRef })).toMatchObject({
        "agent-pr": "false",
        "allowed-bots": "",
      });
    }
  });

  it("GivenAnotherBotOnAnAgentBranch_WhenDecided_ThenNoBotIsAllowed", () => {
    const out = decide({ actor: "other-app[bot]", headRef: "agent/AI-1/x" });
    expect(out).toMatchObject({ "agent-pr": "false", "allowed-bots": "" });
  });

  it("GivenAPersonOnAnAgentBranch_WhenDecided_ThenNoBotIsAllowed", () => {
    const out = decide({ actor: "albernhagen", headRef: "agent/AI-1/x" });
    expect(out).toMatchObject({ mode: "review", "agent-pr": "false", "allowed-bots": "" });
  });

  it("GivenNoAgentBotConfigured_WhenDecided_ThenNoBotIsAllowed", () => {
    for (const settings of [{ agentBot: "" }, { prefix: "" }]) {
      const out = decide({ actor: APP, headRef: "agent/AI-1/x", ...settings });
      expect(out).toMatchObject({ "agent-pr": "false", "allowed-bots": "" });
    }
  });
});

describe("review workflows: agent PR wiring", () => {
  for (const file of ["adversarial-review.yml", "security-review.yml"]) {
    it(`GivenThe${file.split("-")[0]}Workflow_WhenRead_ThenItPassesOnlyThePreparedAllowedBots`, () => {
      const workflow = readFileSync(join(ROOT, ".github/workflows", file), "utf8");
      expect(workflow).toContain(`agent-bot: ${APP}`);
      expect(workflow.match(/allowed_bots:.*$/gm)).toEqual([
        "allowed_bots: ${{ steps.prep.outputs.allowed-bots }} # the agent App on agent/* only (ADR-0141)",
      ]);
    });
  }
});
