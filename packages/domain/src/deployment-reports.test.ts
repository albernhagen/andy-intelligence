import { Deployment } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import {
  mayFinish,
  planStart,
  releaseSource,
  reportingWorkflow,
  reportingWorkflowRef,
} from "./deployment-reports";

const REPO = "albernhagen/andy-intelligence";
const DIGEST = `sha256:${"b".repeat(64)}`;
const SHA = "a".repeat(40);

const deployment = (over: Partial<Deployment> = {}): Deployment =>
  Deployment.parse({
    id: "d1",
    projectId: "ai",
    environment: "prod",
    imageDigest: DIGEST,
    gitSha: SHA,
    kind: "deploy",
    status: "succeeded",
    startedAt: "2026-11-25T10:00:00.000Z",
    finishedAt: "2026-11-25T10:05:00.000Z",
    actor: "system",
    ...over,
  });

describe("reportingWorkflow (AI-190: M6.11)", () => {
  it("GivenDeployOrReleaseOnMain_WhenRead_ThenTheWorkflowIsNamed", () => {
    expect(reportingWorkflow(REPO, reportingWorkflowRef(REPO, "deploy"))).toBe("deploy");
    expect(reportingWorkflow(REPO, `${REPO}/.github/workflows/release.yml@refs/heads/main`)).toBe(
      "release",
    );
  });

  it("GivenAnotherWorkflowRefOrRepo_WhenRead_ThenNull", () => {
    for (const ref of [
      undefined,
      `${REPO}/.github/workflows/ci.yml@refs/heads/main`,
      `${REPO}/.github/workflows/release.yml@refs/heads/evil`,
      `${REPO}/.github/workflows/release.yml@refs/tags/v1`,
      `${REPO}/.github/workflows/release.yml@refs/pull/7/merge`,
      `${REPO}/.github/workflows/deploy.yml@refs/heads/main-2`,
      reportingWorkflowRef("someone/else", "release"),
    ]) {
      expect(reportingWorkflow(REPO, ref), String(ref)).toBeNull();
    }
  });
});

describe("planStart (AI-190: M6.11)", () => {
  it("GivenAReportFromBeforeM611_WhenDeployYmlStarts_ThenProdDeploy", () => {
    expect(planStart("deploy", { imageDigest: DIGEST })).toEqual({
      ok: true,
      workflow: "deploy",
      environment: "prod",
      kind: "deploy",
    });
  });

  it("GivenDeployYmlNamingDev_WhenStarted_ThenDevDeploy", () => {
    expect(
      planStart("deploy", { imageDigest: DIGEST, environment: "dev", kind: "deploy" }),
    ).toMatchObject({ ok: true, environment: "dev", kind: "deploy" });
  });

  it("GivenDeployYmlClaimingAReleaseKindOrARequest_WhenStarted_ThenRefused", () => {
    expect(planStart("deploy", { imageDigest: DIGEST, kind: "rollback" }).ok).toBe(false);
    expect(planStart("deploy", { imageDigest: DIGEST, request: "r1" }).ok).toBe(false);
  });

  it("GivenReleaseYmlWithoutAReleaseKindOrEnvironment_WhenStarted_ThenRefused", () => {
    expect(planStart("release", { imageDigest: DIGEST, environment: "prod" }).ok).toBe(false);
    expect(
      planStart("release", { imageDigest: DIGEST, environment: "prod", kind: "deploy" }).ok,
    ).toBe(false);
    expect(planStart("release", { imageDigest: DIGEST, kind: "rollback" }).ok).toBe(false);
  });

  it("GivenAPromote_WhenStarted_ThenItGoesToProdFromDev", () => {
    expect(
      planStart("release", { imageDigest: DIGEST, environment: "prod", kind: "promote" }),
    ).toEqual({
      ok: true,
      workflow: "release",
      environment: "prod",
      kind: "promote",
      sourceEnvironment: "dev",
    });
    expect(
      planStart("release", { imageDigest: DIGEST, environment: "dev", kind: "promote" }).ok,
    ).toBe(false);
  });

  it("GivenARollback_WhenStarted_ThenItsSourceIsTheSameEnvironment", () => {
    expect(
      planStart("release", { imageDigest: DIGEST, environment: "dev", kind: "rollback" }),
    ).toMatchObject({ ok: true, environment: "dev", kind: "rollback", sourceEnvironment: "dev" });
  });
});

describe("releaseSource (AI-190: M6.11)", () => {
  it("GivenDeploymentsNewestFirst_WhenLookedUp_ThenTheNewestSucceededOneOfThatDigest", () => {
    const other = `sha256:${"c".repeat(64)}`;
    const list = [
      deployment({ id: "d4", imageDigest: other }),
      deployment({ id: "d3", status: "failed" }),
      deployment({ id: "d2" }),
      deployment({ id: "d1" }),
    ];
    expect(releaseSource(list, DIGEST)?.id).toBe("d2");
    expect(releaseSource(list, `sha256:${"d".repeat(64)}`)).toBeNull();
  });
});

describe("mayFinish (AI-190: M6.11)", () => {
  const caller = { workflow: "deploy" as const, projectId: "ai", sha: SHA };

  it("GivenADeploy_WhenFinishedBySameProjectsDeployOfTheSameCommit_ThenAllowed", () => {
    expect(mayFinish(deployment(), caller)).toBe(true);
    expect(mayFinish(deployment(), { ...caller, sha: "c".repeat(40) })).toBe(false);
    expect(mayFinish(deployment(), { ...caller, projectId: "other" })).toBe(false);
  });

  it("GivenARelease_WhenFinished_ThenOnlyReleaseYmlOfTheSameProjectMay", () => {
    const rollback = deployment({ kind: "rollback", gitSha: "e".repeat(40) });
    expect(mayFinish(rollback, { ...caller, workflow: "release" })).toBe(true);
    expect(mayFinish(rollback, caller)).toBe(false);
    expect(mayFinish(rollback, { ...caller, workflow: "release", projectId: "other" })).toBe(false);
    expect(mayFinish(deployment(), { ...caller, workflow: "release" })).toBe(false);
  });
});
