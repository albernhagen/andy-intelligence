import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { callerConfig, firstEnvironment } from "./cloud-run-caller.mjs";

// AI-206: M6.17. The managed repo's deploy.yml and release.yml: their config step, and the files.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/cloud-run-caller.mjs");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const DEPLOY = read("template/.github/workflows/deploy.yml");
const RELEASE = read("template/.github/workflows/release.yml");
const DIGEST = `sha256:${"c".repeat(64)}`;

const env = (prefix, project) => ({
  [`${prefix}PROJECT_ID`]: project,
  [`${prefix}REGION`]: "us-central1",
  [`${prefix}SERVICE`]: "app",
  [`${prefix}SERVICE_URL`]: `https://app-${project}.a.run.app`,
  [`${prefix}WIF_PROVIDER`]: `projects/1/locations/global/workloadIdentityPools/p/providers/${project}`,
  [`${prefix}DEPLOYER_SA`]: `app-deploy@${project}.iam.gserviceaccount.com`,
  [`${prefix}IMAGE_REPO`]: `us-central1-docker.pkg.dev/${project}/app`,
});
const PROD_ONLY = { ...env("GCP_", "app-prod"), DEPLOY_SMOKE_CHECKS: "/health 200" };
const DEV_AND_PROD = { ...PROD_ONLY, ...env("GCP_DEV_", "app-dev") };

describe("callerConfig: deploy", () => {
  it("GivenProdOnlyVariables_WhenDeploy_ThenDeploysToProd", () => {
    expect(callerConfig({ workflow: "deploy", vars: PROD_ONLY })).toEqual({
      environment: "prod",
      project_id: "app-prod",
      region: "us-central1",
      service: "app",
      service_url: "https://app-app-prod.a.run.app",
      wif_provider: PROD_ONLY.GCP_WIF_PROVIDER,
      deployer_sa: PROD_ONLY.GCP_DEPLOYER_SA,
      image_repo: "us-central1-docker.pkg.dev/app-prod/app",
      image: "us-central1-docker.pkg.dev/app-prod/app/app",
    });
  });

  it("GivenDevVariables_WhenDeploy_ThenDeploysToDevFirst", () => {
    const out = callerConfig({ workflow: "deploy", vars: DEV_AND_PROD });
    expect(out.environment).toBe("dev");
    expect(out.project_id).toBe("app-dev");
    expect(firstEnvironment(DEV_AND_PROD)).toBe("dev");
  });

  it("GivenMissingVariables_WhenDeploy_ThenThrowsNamingEachOne", () => {
    const vars = { ...PROD_ONLY, GCP_REGION: "", GCP_SERVICE: undefined, DEPLOY_SMOKE_CHECKS: "" };
    expect(() => callerConfig({ workflow: "deploy", vars })).toThrow(
      "missing repo variables GCP_REGION, GCP_SERVICE, DEPLOY_SMOKE_CHECKS",
    );
  });

  it("GivenOnlyTheDevProviderSet_WhenDeploy_ThenNamesTheMissingDevVariables", () => {
    const vars = { ...PROD_ONLY, GCP_DEV_WIF_PROVIDER: "projects/1/x" };
    expect(() => callerConfig({ workflow: "deploy", vars })).toThrow("GCP_DEV_PROJECT_ID");
  });

  it("GivenMalformedSmokeChecks_WhenDeploy_ThenThrowsBeforeBuilding", () => {
    const vars = { ...PROD_ONLY, DEPLOY_SMOKE_CHECKS: "health 200" };
    expect(() => callerConfig({ workflow: "deploy", vars })).toThrow("smoke-checks:");
  });

  it("GivenAVariableWithANewline_WhenDeploy_ThenThrowsRatherThanWriteAnotherOutput", () => {
    const vars = { ...PROD_ONLY, GCP_SERVICE: "app\nimage=evil" };
    expect(() => callerConfig({ workflow: "deploy", vars })).toThrow(
      "GCP_SERVICE must be one line",
    );
  });

  it("GivenAnUnknownWorkflow_WhenConfig_ThenThrows", () => {
    expect(() => callerConfig({ workflow: "verify", vars: PROD_ONLY })).toThrow(
      "deploy, release or preview",
    );
  });
});

const preview = (prefix, project) => ({
  [`${prefix}PREVIEW_SERVICE`]: "app-preview",
  [`${prefix}PREVIEW_DEPLOYER_SA`]: `app-pr-deploy@${project}.iam.gserviceaccount.com`,
  [`${prefix}PREVIEW_IMAGE_REPO`]: `us-central1-docker.pkg.dev/${project}/app-preview`,
});

describe("callerConfig: preview (AI-207: M6.18)", () => {
  it("GivenProdOnlyWithPreviewVariables_WhenPreview_ThenUsesProdsPreviewService", () => {
    const vars = { ...PROD_ONLY, ...preview("GCP_", "app-prod"), DEPLOY_SMOKE_CHECKS: "" };
    expect(callerConfig({ workflow: "preview", vars })).toEqual({
      environment: "prod",
      project_id: "app-prod",
      region: "us-central1",
      wif_provider: PROD_ONLY.GCP_WIF_PROVIDER,
      preview_service: "app-preview",
      preview_deployer_sa: "app-pr-deploy@app-prod.iam.gserviceaccount.com",
      preview_image_repo: "us-central1-docker.pkg.dev/app-prod/app-preview",
      preview_image: "us-central1-docker.pkg.dev/app-prod/app-preview/app-preview",
    });
  });

  it("GivenDevAndProd_WhenPreview_ThenUsesDevsPreviewService", () => {
    const vars = { ...DEV_AND_PROD, ...preview("GCP_DEV_", "app-dev") };
    const out = callerConfig({ workflow: "preview", vars });
    expect(out.environment).toBe("dev");
    expect(out.project_id).toBe("app-dev");
  });

  it("GivenNoPreviewVariables_WhenPreview_ThenNamesEachOne", () => {
    expect(() => callerConfig({ workflow: "preview", vars: PROD_ONLY })).toThrow(
      "missing repo variables GCP_PREVIEW_SERVICE, GCP_PREVIEW_DEPLOYER_SA, GCP_PREVIEW_IMAGE_REPO",
    );
  });

  it("GivenOnlyProdPreviewVariablesInDevAndProd_WhenPreview_ThenNamesTheDevOnes", () => {
    const vars = { ...DEV_AND_PROD, ...preview("GCP_", "app-prod") };
    expect(() => callerConfig({ workflow: "preview", vars })).toThrow("GCP_DEV_PREVIEW_SERVICE");
  });
});

describe("callerConfig: release", () => {
  it("GivenDevAndProd_WhenPromote_ThenShipsFromTheDevImageToProd", () => {
    const out = callerConfig({
      workflow: "release",
      vars: DEV_AND_PROD,
      inputs: { action: "promote", environment: "prod", digest: DIGEST, request: "r-1" },
    });
    expect(out).toMatchObject({
      action: "promote",
      environment: "prod",
      digest: DIGEST,
      request: "r-1",
      project_id: "app-prod",
      source_image: "us-central1-docker.pkg.dev/app-dev/app/app",
    });
  });

  it("GivenProdOnly_WhenPromote_ThenTheSourceIsProdsOwnImage", () => {
    const out = callerConfig({
      workflow: "release",
      vars: PROD_ONLY,
      inputs: { action: "promote", environment: "prod", digest: DIGEST },
    });
    expect(out.source_image).toBe("us-central1-docker.pkg.dev/app-prod/app/app");
  });

  it("GivenRollbackWithoutSmokeChecks_WhenRelease_ThenPasses", () => {
    const vars = { ...PROD_ONLY, DEPLOY_SMOKE_CHECKS: "" };
    const out = callerConfig({
      workflow: "release",
      vars,
      inputs: { action: "rollback", environment: "prod", revision: "app-00002-abc" },
    });
    expect(out).toMatchObject({ action: "rollback", revision: "app-00002-abc", source_image: "" });
  });

  it("GivenRollbackOfAnEnvironmentNotSetUp_WhenRelease_ThenNamesItsVariables", () => {
    expect(() =>
      callerConfig({
        workflow: "release",
        vars: PROD_ONLY,
        inputs: { action: "rollback", environment: "dev", revision: "app-00002-abc" },
      }),
    ).toThrow("GCP_DEV_WIF_PROVIDER");
  });

  it("GivenBadInputs_WhenRelease_ThenThrowsTheInputCheck", () => {
    expect(() =>
      callerConfig({
        workflow: "release",
        vars: DEV_AND_PROD,
        inputs: { action: "promote", environment: "dev", digest: DIGEST },
      }),
    ).toThrow("promote goes to prod");
  });
});

describe("the script", () => {
  const run = (extra) =>
    spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: "", ...extra },
    });

  it("GivenAMissingVariable_WhenRun_ThenExitsNonZeroNamingIt", () => {
    const vars = { ...PROD_ONLY, GCP_DEPLOYER_SA: "" };
    const r = run({ WORKFLOW: "deploy", VARS: JSON.stringify(vars) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("::error::missing repo variable GCP_DEPLOYER_SA");
  });

  it("GivenUnparsableVars_WhenRun_ThenExitsWithoutEchoingThem", () => {
    const r = run({ WORKFLOW: "deploy", VARS: '{"private-value' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("VARS: expected the repo variables as a JSON object");
    expect(r.stderr).not.toContain("private-value");
  });

  it("GivenEveryVariable_WhenRun_ThenWritesTheOutputs", () => {
    const r = run({ WORKFLOW: "deploy", VARS: JSON.stringify(PROD_ONLY) });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("environment=prod\n");
    expect(r.stdout).toContain("image=us-central1-docker.pkg.dev/app-prod/app/app\n");
  });
});

describe.each([
  ["deploy.yml", DEPLOY],
  ["release.yml", RELEASE],
])("template %s", (name, text) => {
  const steps = text.slice(text.indexOf("    steps:"));

  it("GivenTheWorkflow_WhenRead_ThenTheConfigStepRunsBeforeAnyCheckoutCloudCallOrBuild", () => {
    const config = steps.indexOf("uses: ./platform/actions/cloud-run-caller-config");
    expect(config).toBeGreaterThan(0);
    for (const later of [
      "actions/checkout@",
      "google-github-actions/auth@",
      "build-push-action@",
    ]) {
      const at = steps.indexOf(later);
      if (at >= 0) expect(at).toBeGreaterThan(config);
    }
  });

  it("GivenTheWorkflow_WhenRead_ThenCredentialsComeOnlyOnPushToMainOrDispatch", () => {
    const on = text.slice(text.indexOf("\non:"), text.indexOf("\nconcurrency:"));
    const triggers = [...on.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
    expect(triggers.every((t) => ["push", "workflow_dispatch"].includes(t))).toBe(true);
    if (triggers.includes("push")) expect(on).toMatch(/branches: \[main\]/);
    expect(text).not.toMatch(/pull_request|repository_dispatch|schedule:/);
    expect(text).toMatch(/permissions: \{\}/);
    expect(text).toContain("github.ref == 'refs/heads/main'");
    expect(text.match(/id-token: write/g)).toHaveLength(1);
  });

  it("GivenTheWorkflow_WhenRead_ThenEveryThirdPartyActionIsPinnedToASha", () => {
    const uses = [...text.matchAll(/uses:\s+(\S+)/g)].map((m) => m[1]);
    for (const u of uses.filter((u) => !u.startsWith("./"))) {
      expect(u).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("GivenTheWorkflow_WhenRead_ThenItReportsStartAndFinish", () => {
    expect(text).toContain("phase: start");
    expect(text).toContain("phase: finish");
  });
});

describe("template release.yml meets the release contract (ADR-0114)", () => {
  it("GivenTheDispatchInputs_WhenRead_ThenTheyAreTheContractsFive", () => {
    const inputs = RELEASE.slice(RELEASE.indexOf("    inputs:"), RELEASE.indexOf("\nconcurrency:"));
    const names = [...inputs.matchAll(/^ {6}(\w+):$/gm)].map((m) => m[1]);
    expect(names).toEqual(["action", "environment", "digest", "revision", "request"]);
  });

  it("GivenControlPlaneRelease_WhenCompared_ThenTheStepsAreTheSame", () => {
    const ids = (text) => [...text.matchAll(/^ {6}- id: ([\w-]+)$/gm)].map((m) => m[1]);
    const ours = ids(RELEASE).filter((id) => id !== "config");
    const theirs = ids(read(".github/workflows/release.yml")).filter((id) => id !== "inputs");
    expect(ours).toEqual(theirs);
  });
});
