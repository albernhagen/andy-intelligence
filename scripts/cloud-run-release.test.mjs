import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkImage,
  checkInputs,
  checkRevision,
  digestOf,
  readTarget,
  renderRollbackSummary,
  rollbackVerdict,
} from "./cloud-run-release.mjs";

// AI-190: M6.11. The release workflow's logic, and the workflow and actions as written.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/cloud-run-release.mjs");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const RELEASE = read(".github/workflows/release.yml");
const DEPLOY = read(".github/workflows/deploy.yml");
const DIGEST = `sha256:${"b".repeat(64)}`;

const rollback = {
  action: "rollback",
  environment: "prod",
  revision: "cp-00041-abc",
  configured: "x",
};
const promote = { action: "promote", environment: "prod", digest: DIGEST, configured: "x" };

describe("checkInputs", () => {
  it("GivenARollbackWithARevision_WhenChecked_ThenAccepted", () => {
    expect(checkInputs({ ...rollback, request: "req-1" })).toEqual({
      action: "rollback",
      environment: "prod",
      digest: "",
      revision: "cp-00041-abc",
      request: "req-1",
    });
  });

  it("GivenAPromoteToProdWithADigest_WhenChecked_ThenAccepted", () => {
    expect(checkInputs(promote)).toMatchObject({ action: "promote", digest: DIGEST, request: "" });
  });

  it("GivenBadInputs_WhenChecked_ThenRefusedBeforeAnyCloudCall", () => {
    const refused = [
      [{ ...rollback, action: "deploy" }, "action must be promote or rollback"],
      [{ ...rollback, environment: "preview" }, "environment must be dev or prod"],
      [{ ...rollback, configured: "" }, "environment prod is not set up for this repo"],
      [{ ...rollback, request: "a b" }, "request must be"],
      [{ ...rollback, revision: "" }, "rollback needs a revision name"],
      [{ ...rollback, revision: "cp; gcloud projects delete x" }, "rollback needs a revision name"],
      [{ ...rollback, revision: "Cp-1" }, "rollback needs a revision name"],
      [{ ...rollback, digest: DIGEST }, "rollback takes a revision, not a digest"],
      [{ ...promote, digest: "latest" }, "promote needs digest"],
      [{ ...promote, revision: "cp-1" }, "promote takes a digest, not a revision"],
      [{ ...promote, environment: "dev" }, "promote goes to prod"],
    ];
    for (const [inputs, message] of refused) {
      expect(() => checkInputs(inputs), JSON.stringify(inputs)).toThrow(message);
    }
  });

  it("GivenTheInputsCommand_WhenRunWithABadRevision_ThenItExitsNonZeroWithAnError", () => {
    const r = spawnSync("node", [SCRIPT, "inputs"], {
      env: {
        PATH: process.env.PATH,
        ACTION: "rollback",
        ENVIRONMENT: "prod",
        REVISION: "",
        CONFIGURED: "x",
      },
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("::error::rollback needs a revision name");
  });
});

describe("existence checks", () => {
  const revision = (over = {}) => ({
    metadata: { name: "cp-00041-abc", labels: { "serving.knative.dev/service": "control-plane" } },
    status: {
      conditions: [{ type: "Ready", status: "True" }],
      imageDigest: `us-central1-docker.pkg.dev/p/r/control-plane@${DIGEST}`,
    },
    ...over,
  });

  it("GivenAReadyRevisionOfTheService_WhenChecked_ThenItsImageDigestIsTheOutput", () => {
    expect(checkRevision(revision(), "control-plane")).toEqual({ image_digest: DIGEST });
  });

  it("GivenAnotherServicesNotReadyOrDigestlessRevision_WhenChecked_ThenItFails", () => {
    expect(() => checkRevision(revision(), "other")).toThrow("is not a revision of other");
    expect(() =>
      checkRevision(
        revision({
          status: { conditions: [{ type: "Ready", status: "False" }], imageDigest: DIGEST },
        }),
        "control-plane",
      ),
    ).toThrow("is not ready");
    expect(() =>
      checkRevision(
        revision({ status: { conditions: [{ type: "Ready", status: "True" }] } }),
        "control-plane",
      ),
    ).toThrow("has no image digest");
  });

  it("GivenAnImageReference_WhenItsDigestIsRead_ThenOnlyAFullDigestCounts", () => {
    expect(digestOf(`repo/img@${DIGEST}`)).toBe(DIGEST);
    expect(digestOf("repo/img:latest")).toBeNull();
    expect(digestOf(undefined)).toBeNull();
  });

  it("GivenTheRegistryAnswer_WhenTheImageIsChecked_ThenOnlyTheSameDigestPasses", () => {
    expect(checkImage({ image_summary: { digest: DIGEST } }, DIGEST)).toEqual({
      image_digest: DIGEST,
    });
    expect(() => checkImage({}, DIGEST)).toThrow("not found in the registry");
  });

  it("GivenAServiceWithAPublicUrl_WhenRead_ThenThatUrlAndTheTraffic", () => {
    const service = {
      status: { url: "https://cp.run.app", traffic: [{ revisionName: "cp-2", percent: 100 }] },
      spec: {
        template: {
          spec: {
            containers: [{ env: [{ name: "PUBLIC_URL", value: "https://ai.example.com/" }] }],
          },
        },
      },
    };
    expect(readTarget(service)).toEqual({ url: "https://ai.example.com", serving: "cp-2=100" });
    expect(readTarget({ status: { url: "https://cp.run.app" } }).url).toBe("https://cp.run.app");
  });
});

describe("rollback summary", () => {
  it("GivenEachOutcome_WhenSummarised_ThenTheVerdictSaysWhatHappenedToTraffic", () => {
    expect(rollbackVerdict({ pin: "skipped" })).toContain("Traffic did not move");
    expect(rollbackVerdict({ pin: "failure" })).toContain("Compare the serving revision");
    expect(rollbackVerdict({ pin: "success", verify: "success", health: "failure" })).toContain(
      "the check failed",
    );
    expect(rollbackVerdict({ pin: "success", verify: "success", health: "success" })).toContain(
      "Rolled back",
    );
  });

  it("GivenWhatServedBefore_WhenSummarised_ThenTheCommandToReturnToItIsShown", () => {
    const summary = renderRollbackSummary({
      service: "control-plane",
      region: "us-central1",
      revision: "cp-1",
      before: "cp-2=100",
      after: "cp-1=100",
      outcomes: { pin: "success", verify: "success", health: "success" },
    });
    expect(summary).toContain(
      "gcloud run services update-traffic control-plane --region us-central1 --to-revisions=cp-2=100",
    );
    expect(summary).toContain("| Asked for | `cp-1` |");
  });
});

/** The lines of a step (from `- id: <id>` to the next step at the same indent). */
function step(workflow, id) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- id: ${id}`);
  if (start < 0) throw new Error(`no step ${id}`);
  const indent = lines[start].indexOf("-");
  let end = start + 1;
  while (end < lines.length && !(lines[end].trim() && lines[end].search(/\S/) <= indent)) end++;
  return { at: start, text: lines.slice(start, end).join("\n") };
}

describe("release.yml as written", () => {
  it("GivenTheWorkflow_WhenRead_ThenOnlyWorkflowDispatchStartsIt", () => {
    const on = /\non:\n([\s\S]*?)\n\S/.exec(RELEASE)[1];
    expect(on.split("\n").filter((l) => /^ {2}\S/.test(l))).toEqual(["  workflow_dispatch:"]);
    expect(RELEASE).not.toMatch(/repository_dispatch|pull_request|push:|schedule:/);
    expect(RELEASE).toContain("if: github.ref == 'refs/heads/main'");
  });

  it("GivenTheWorkflow_WhenRead_ThenItTakesTheFiveContractInputs", () => {
    const inputs = /\n {4}inputs:\n([\s\S]*?)\n\n/.exec(RELEASE)[1];
    const names = inputs
      .split("\n")
      .filter((l) => /^ {6}\w+:$/.test(l))
      .map((l) => l.trim());
    expect(names).toEqual(["action:", "environment:", "digest:", "revision:", "request:"]);
  });

  it("GivenADeployAndAReleaseToProd_WhenBothRun_ThenTheyShareOneQueueAndNeitherIsCancelled", () => {
    expect(RELEASE).toContain(
      "group: ${{ github.ref == 'refs/heads/main' && format('deploy-{0}', inputs.environment) || format('off-main-{0}', github.run_id) }}\n  cancel-in-progress: false",
    );
    expect(DEPLOY).toMatch(
      /concurrency:\n {2}group: deploy-prod\b[^\n]*\n {2}cancel-in-progress: false/,
    );
  });

  it("GivenTheSteps_WhenOrdered_ThenInputsAndExistenceAreCheckedBeforeTrafficOrARecordChanges", () => {
    const order = ["inputs", "auth", "check", "report-start", "gate", "promote", "rollback"].map(
      (id) => step(RELEASE, id).at,
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(step(RELEASE, "promote").text).toContain(
      "uses: ./platform/actions/cloud-run-safe-deploy",
    );
    expect(step(RELEASE, "promote").text).toContain("@${{ steps.check.outputs.image-digest }}");
    expect(step(RELEASE, "rollback").text).toContain("uses: ./platform/actions/cloud-run-rollback");
    expect(step(RELEASE, "report-start").text).toMatch(
      /kind: \$\{\{ steps\.inputs\.outputs\.action \}\}/,
    );
  });

  it("GivenUntrustedInputs_WhenUsedInAShellStep_ThenTheyArriveThroughEnvOnly", () => {
    for (const file of [
      ".github/workflows/release.yml",
      "platform/actions/cloud-run-release-check/action.yml",
      "platform/actions/cloud-run-rollback/action.yml",
    ]) {
      const runs = read(file).match(/run: [^\n]*(\n {8,}[^\n]*)*/g) ?? [];
      expect(runs.length, file).toBeGreaterThan(0);
      for (const run of runs) expect(run, file).not.toContain("${{");
    }
  });

  it("GivenTheWorkflow_WhenRead_ThenPermissionsAreMinimalAndThirdPartyActionsArePinned", () => {
    expect(RELEASE).toContain("\npermissions: {}\n");
    expect(RELEASE).toMatch(/permissions:\n {6}contents: read\n {6}id-token: write/);
    for (const [, ref] of RELEASE.matchAll(/uses: ([^\s.][^\s]*)/g)) {
      expect(ref).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("GivenAPromoteTheControlPlaneRefused_WhenTheGateRuns_ThenTheRunStopsBeforeTraffic", () => {
    const gate = step(RELEASE, "gate").text;
    expect(gate).toContain(
      "if: steps.inputs.outputs.action == 'promote' && steps.report-start.outputs.refused == 'true'",
    );
    expect(gate).toContain("exit 1");
  });

  it("GivenTrafficMovedButACheckFailed_WhenFinished_ThenTheReportNamesWhatServes", () => {
    expect(RELEASE).toContain(
      "revision: ${{ steps.rollback.outputs.pinned == 'true' && steps.inputs.outputs.revision || steps.promote.outputs.promoted == 'true' && steps.promote.outputs.candidate || '' }}",
    );
    expect(read("platform/actions/cloud-run-rollback/action.yml")).toContain(
      "value: ${{ steps.pin.outcome == 'success' }}",
    );
    expect(read("platform/actions/cloud-run-safe-deploy/action.yml")).toContain(
      "value: ${{ steps.promote.outcome == 'success' }}",
    );
  });
});
