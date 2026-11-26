import { InMemoryDeploymentStore, type Deployment, type Project } from "@andy/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthEnv } from "./auth";
import {
  DEPLOYMENTS_PATH,
  DEPLOYMENT_REPORT_RATE_LIMIT,
  deployWorkflowRef,
  registerDeploymentCallbacks,
  releaseWorkflowRef,
} from "./deployments";
import type { ActionsClaims } from "./github/token";

const REPO = "albernhagen/andy-intelligence";
const SHA = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const project = { id: "ai", key: "AI", enabled: true, repos: [REPO] } as unknown as Project;

/** The deploy workflow's token for REPO at SHA; overrides change one claim. */
const claims = (overrides: Partial<ActionsClaims> = {}): ActionsClaims => ({
  repository: REPO,
  workflow_ref: deployWorkflowRef(REPO),
  job_workflow_ref: deployWorkflowRef(REPO),
  run_id: "42",
  sha: SHA,
  ...overrides,
});

/** `tickMs`: how far the clock moves on each read (0 keeps every call in one rate window). */
function setup(
  projects: Record<string, Project> = { [REPO]: project },
  tickMs = 60_000,
  onFinished?: (deployment: Deployment, project: Project) => Promise<unknown>,
) {
  const app = new Hono<AuthEnv>();
  const deployments = new InMemoryDeploymentStore();
  let clock = Date.parse("2026-11-21T10:00:00.000Z");
  registerDeploymentCallbacks(app, {
    deployments,
    // Stand-in for Actions OIDC verification: the bearer is the JSON of its claims.
    verify: async (jwt) => {
      if (!jwt.startsWith("{")) throw new Error("bad signature");
      return JSON.parse(jwt) as ActionsClaims;
    },
    registeredProject: async (repo) => projects[repo] ?? null,
    now: () => new Date((clock += tickMs)),
    ...(onFinished ? { onFinished } : {}),
  });
  const post = (path: string, body: unknown, token: ActionsClaims | string | null = claims()) =>
    app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === null
          ? {}
          : {
              authorization: `Bearer ${typeof token === "string" ? token : JSON.stringify(token)}`,
            }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const start = (token?: ActionsClaims | string | null, body: unknown = { imageDigest: DIGEST }) =>
    post(DEPLOYMENTS_PATH, body, token);
  const finish = (id: string, body: unknown, token?: ActionsClaims | string | null) =>
    post(`/deployments/${id}/finish`, body, token);
  return { deployments, start, finish };
}

/** release.yml's token: the run started on main at a later commit than the build it ships. */
const MAIN_SHA = "f".repeat(40);
const release = (overrides: Partial<ActionsClaims> = {}) =>
  claims({ workflow_ref: releaseWorkflowRef(REPO), sha: MAIN_SHA, ...overrides });
const idOf = async (r: Response) => ((await r.json()) as { deploymentId: string }).deploymentId;

describe("deployment reports (AI-180: M6.4)", () => {
  it("GivenTheDeployWorkflowOnMain_WhenItStartsAndFinishes_ThenADeploymentIsRecordedFromTheToken", async () => {
    const { deployments, start, finish } = setup();
    const started = await start();
    expect(started.status).toBe(201);
    const { deploymentId } = (await started.json()) as { deploymentId: string };
    expect(await deployments.get(deploymentId)).toMatchObject({
      projectId: "ai",
      environment: "prod",
      gitSha: SHA,
      imageDigest: DIGEST,
      kind: "deploy",
      status: "started",
      actor: "system",
      previousDeploymentId: null,
    });

    const done = await finish(deploymentId, {
      status: "succeeded",
      revision: "control-plane-00042-abc",
    });
    expect(done.status).toBe(200);
    expect(await deployments.get(deploymentId)).toMatchObject({
      status: "succeeded",
      revision: "control-plane-00042-abc",
    });
    expect((await deployments.latestGood("ai", "prod"))?.id).toBe(deploymentId);
  });

  it("GivenAnEarlierGoodDeploy_WhenTheNextStarts_ThenItNamesThePreviousOne", async () => {
    const { deployments, start, finish } = setup();
    const first = ((await (await start()).json()) as { deploymentId: string }).deploymentId;
    await finish(first, { status: "succeeded" });
    const second = ((await (await start()).json()) as { deploymentId: string }).deploymentId;
    expect((await deployments.get(second))?.previousDeploymentId).toBe(first);
  });

  it("GivenATokenThatIsNotTheRegisteredReposDeployWorkflowOnMain_WhenReporting_Then403AndNothingRecorded", async () => {
    const other = "someone/else";
    const disabled = { ...project, enabled: false } as Project;
    const { deployments, start } = setup({ [REPO]: project, "albernhagen/off": disabled });
    const refused: ActionsClaims[] = [
      // Another workflow in the same repo, or the deploy workflow on another branch.
      claims({ workflow_ref: `${REPO}/.github/workflows/ci.yml@refs/heads/main` }),
      claims({ workflow_ref: `${REPO}/.github/workflows/deploy.yml@refs/heads/evil` }),
      claims({ workflow_ref: `${REPO}/.github/workflows/deploy.yml@refs/pull/7/merge` }),
      // A registered repo's workflow claiming to be another repo's.
      claims({ workflow_ref: deployWorkflowRef(other) }),
      // An unregistered repo's own deploy workflow, and a disabled project's.
      claims({ repository: other, workflow_ref: deployWorkflowRef(other) }),
      claims({ repository: "albernhagen/off", workflow_ref: deployWorkflowRef("albernhagen/off") }),
      // No commit, or not a commit sha.
      claims({ sha: undefined }),
      claims({ sha: "main" }),
    ];
    for (const token of refused) {
      expect((await start(token)).status, JSON.stringify(token)).toBe(403);
    }
    expect(await deployments.list("ai", "prod")).toEqual([]);
  });

  it("GivenNoOrAForgedToken_WhenReporting_Then401", async () => {
    const { deployments, start } = setup();
    expect((await start(null)).status).toBe(401);
    expect((await start("forged")).status).toBe(401);
    expect(await deployments.list("ai", "prod")).toEqual([]);
  });

  it("GivenAnotherCommitsDeploy_WhenItFinishesThisDeployment_Then404AndItStaysStarted", async () => {
    const { deployments, start, finish } = setup();
    const id = ((await (await start()).json()) as { deploymentId: string }).deploymentId;
    expect(
      (await finish(id, { status: "succeeded" }, claims({ sha: "c".repeat(40) }))).status,
    ).toBe(404);
    expect((await finish("missing", { status: "succeeded" })).status).toBe(404);
    expect((await deployments.get(id))?.status).toBe("started");
  });

  it("GivenAFinishedDeployment_WhenFinishedAgain_Then409", async () => {
    const { start, finish } = setup();
    const id = ((await (await start()).json()) as { deploymentId: string }).deploymentId;
    expect((await finish(id, { status: "failed" })).status).toBe(200);
    expect((await finish(id, { status: "succeeded" })).status).toBe(409);
  });

  it("GivenABadOrOversizedBody_WhenReporting_ThenRefusedBeforeAnythingIsStored", async () => {
    const { deployments, start, finish } = setup();
    expect((await start(undefined, { imageDigest: "latest" })).status).toBe(400);
    // Body fields can't set what the token proves.
    expect((await start(undefined, { imageDigest: DIGEST, gitSha: "c".repeat(40) })).status).toBe(
      400,
    );
    expect((await start(undefined, "x".repeat(2048))).status).toBe(413);
    const id = ((await (await start()).json()) as { deploymentId: string }).deploymentId;
    expect((await finish(id, { status: "rolled-back" })).status).toBe(400);
    expect(await deployments.list("ai", "prod")).toHaveLength(1);
  });

  it("GivenManyVerifiedReports_WhenOverTheCap_Then429", async () => {
    const { start } = setup(undefined, 0);
    for (let i = 0; i < DEPLOYMENT_REPORT_RATE_LIMIT; i += 1) await start();
    expect((await start()).status).toBe(429);
  });
});

describe("verification hook (AI-188: M6.7)", () => {
  it("GivenAFinishedDeploy_WhenRecorded_ThenTheHookGetsTheFinishedDeploymentAndItsProjectOnce", async () => {
    const seen: [Deployment, Project][] = [];
    const { start, finish } = setup(undefined, undefined, async (d, p) => seen.push([d, p]));
    const id = await idOf(await start());

    expect((await finish(id, { status: "succeeded" })).status).toBe(200);
    expect((await finish(id, { status: "succeeded" })).status).toBe(409);

    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toMatchObject({ id, status: "succeeded" });
    expect(seen[0]![1].id).toBe("ai");
  });

  it("GivenAHookThatThrows_WhenTheDeployFinishes_ThenTheFinishIsStillRecordedAnd200", async () => {
    const { deployments, start, finish } = setup(undefined, undefined, async () => {
      throw new Error("boom");
    });
    const id = await idOf(await start());

    expect((await finish(id, { status: "failed" })).status).toBe(200);
    expect((await deployments.get(id))?.status).toBe("failed");
  });

  it("GivenARefusedFinish_WhenReported_ThenTheHookIsNotCalled", async () => {
    let calls = 0;
    const { start, finish } = setup(undefined, undefined, async () => calls++);
    const id = await idOf(await start());

    expect(
      (await finish(id, { status: "succeeded" }, claims({ sha: "c".repeat(40) }))).status,
    ).toBe(404);
    expect(calls).toBe(0);
  });
});

describe("release reports (AI-190: M6.11)", () => {
  it("GivenReleaseYmlRollingBackToADeployedBuild_WhenItReports_ThenARollbackIsRecordedWithTheBuildsCommitUrlAndRequest", async () => {
    const { deployments, start, finish } = setup();
    const built = await idOf(await start());
    await finish(built, { status: "succeeded", revision: "control-plane-00041-old" });
    const later = `sha256:${"c".repeat(64)}`;
    const newer = await idOf(await start(undefined, { imageDigest: later }));
    await finish(newer, { status: "succeeded", revision: "control-plane-00042-new" });

    const started = await start(release(), {
      imageDigest: DIGEST,
      environment: "prod",
      kind: "rollback",
      url: "https://ai.example.com",
      request: "req-1",
    });
    expect(started.status).toBe(201);
    const id = await idOf(started);
    expect(await deployments.get(id)).toMatchObject({
      environment: "prod",
      kind: "rollback",
      imageDigest: DIGEST,
      gitSha: SHA,
      url: "https://ai.example.com",
      request: "req-1",
      previousDeploymentId: newer,
      status: "started",
    });

    const done = await finish(
      id,
      { status: "succeeded", revision: "control-plane-00041-old" },
      release(),
    );
    expect(done.status).toBe(200);
    expect((await deployments.latestGood("ai", "prod"))?.id).toBe(id);
  });

  it("GivenADigestDevDeployed_WhenReleaseYmlPromotesItToProd_ThenAProdPromoteIsRecorded", async () => {
    const { deployments, start, finish } = setup();
    const dev = await idOf(await start(undefined, { imageDigest: DIGEST, environment: "dev" }));
    await finish(dev, { status: "succeeded" });
    const id = await idOf(
      await start(release(), {
        imageDigest: DIGEST,
        environment: "prod",
        kind: "promote",
        url: "https://prod.example.com",
      }),
    );
    expect(await deployments.get(id)).toMatchObject({
      environment: "prod",
      kind: "promote",
      gitSha: SHA,
      request: null,
    });
    expect(await deployments.list("ai", "dev")).toHaveLength(1);
  });

  it("GivenADigestNoSucceededDeploymentShipped_WhenReleaseYmlReportsIt_Then422AndNothingRecorded", async () => {
    const { deployments, start, finish } = setup();
    const failed = await idOf(await start());
    await finish(failed, { status: "failed" });
    const rollback = { imageDigest: DIGEST, environment: "prod", kind: "rollback" };
    expect((await start(release(), rollback)).status).toBe(422);
    // Promote reads dev: a prod deployment of the digest is not a source.
    expect((await start(release(), { ...rollback, kind: "promote" })).status).toBe(422);
    expect(await deployments.list("ai", "prod")).toHaveLength(1);
  });

  it("GivenAKindTheWorkflowDoesNotReport_WhenStarted_Then422AndNothingRecorded", async () => {
    const { deployments, start } = setup();
    expect((await start(undefined, { imageDigest: DIGEST, kind: "rollback" })).status).toBe(422);
    expect((await start(undefined, { imageDigest: DIGEST, request: "r1" })).status).toBe(422);
    expect((await start(release(), { imageDigest: DIGEST, environment: "prod" })).status).toBe(422);
    expect(
      (await start(release(), { imageDigest: DIGEST, environment: "prod", kind: "deploy" })).status,
    ).toBe(422);
    expect(
      (await start(release(), { imageDigest: DIGEST, environment: "preview", kind: "rollback" }))
        .status,
    ).toBe(400);
    expect(await deployments.list("ai", "prod")).toEqual([]);
  });

  it("GivenReleaseYmlOffMainOrFromAnotherRepo_WhenReporting_Then403", async () => {
    const { deployments, start } = setup();
    const body = { imageDigest: DIGEST, environment: "prod", kind: "rollback" };
    for (const token of [
      release({ workflow_ref: `${REPO}/.github/workflows/release.yml@refs/heads/evil` }),
      release({ workflow_ref: `${REPO}/.github/workflows/release.yml@refs/tags/v1` }),
      release({ workflow_ref: releaseWorkflowRef("someone/else") }),
      release({ repository: "someone/else", workflow_ref: releaseWorkflowRef("someone/else") }),
    ]) {
      expect((await start(token, body)).status, JSON.stringify(token)).toBe(403);
    }
    expect(await deployments.list("ai", "prod")).toEqual([]);
  });

  it("GivenADeployAndARelease_WhenTheOtherWorkflowFinishesIt_Then404AndItStaysStarted", async () => {
    const { deployments, start, finish } = setup();
    const built = await idOf(await start());
    await finish(built, { status: "succeeded" });
    const deploy = await idOf(await start());
    const rollback = await idOf(
      await start(release(), { imageDigest: DIGEST, environment: "prod", kind: "rollback" }),
    );
    expect((await finish(deploy, { status: "succeeded" }, release({ sha: SHA }))).status).toBe(404);
    expect((await finish(rollback, { status: "succeeded" })).status).toBe(404);
    expect((await deployments.get(deploy))?.status).toBe("started");
    expect((await deployments.get(rollback))?.status).toBe("started");
  });
});
