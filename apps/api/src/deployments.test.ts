import {
  InMemoryDeploymentStore,
  InMemoryReleaseRequestStore,
  type Project,
} from "@andy/contracts";
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
  releaseRequests?: InMemoryReleaseRequestStore,
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
    ...(releaseRequests ? { releaseRequests } : {}),
    now: () => new Date((clock += tickMs)),
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

describe("release requests matched to reports (AI-199: M6.12)", () => {
  const PROMOTED = `sha256:${"c".repeat(64)}`;
  const at = "2026-11-21T09:00:00.000Z";
  const asked = async (
    requests: InMemoryReleaseRequestStore,
    overrides: { action?: "promote" | "rollback"; digest?: string } = {},
  ) => {
    const made = await requests.create(
      {
        projectId: "ai",
        action: overrides.action ?? "promote",
        environment: "prod",
        digest: overrides.digest ?? PROMOTED,
        revision: overrides.action === "rollback" ? "control-plane-00041-old" : null,
        sourceDeploymentId: "src",
        actor: "user:andy",
        createdAt: at,
        status: "dispatched",
        updatedAt: at,
      },
      0,
    );
    if (!("created" in made)) throw new Error("not created");
    return made.created;
  };
  const devBuild = async (s: ReturnType<typeof setup>) => {
    const dev = await idOf(await s.start(undefined, { imageDigest: PROMOTED, environment: "dev" }));
    await s.finish(dev, { status: "succeeded", revision: "control-plane-dev-1" });
  };

  it("GivenTheOwnersPromoteRequest_WhenReleaseYmlReportsStartAndEnd_ThenTheRequestFollowsTheDeployment", async () => {
    const requests = new InMemoryReleaseRequestStore();
    const s = setup(undefined, undefined, requests);
    await devBuild(s);
    const request = await asked(requests);

    const started = await s.start(release(), {
      imageDigest: PROMOTED,
      environment: "prod",
      kind: "promote",
      request: request.id,
    });
    expect(started.status).toBe(201);
    const id = await idOf(started);
    expect(await requests.get(request.id)).toMatchObject({ status: "started", deploymentId: id });

    await s.finish(id, { status: "succeeded", revision: "control-plane-00050" }, release());
    expect((await requests.get(request.id))?.status).toBe("succeeded");
  });

  it("GivenAReportNamingAnUnknownOrDifferentRequest_WhenItStarts_Then422AndNothingRecorded", async () => {
    const requests = new InMemoryReleaseRequestStore();
    const s = setup(undefined, undefined, requests);
    await devBuild(s);
    const rollback = await asked(requests, { action: "rollback" });
    const before = await s.deployments.list("ai", "prod");
    for (const request of ["nope", rollback.id]) {
      const res = await s.start(release(), {
        imageDigest: PROMOTED,
        environment: "prod",
        kind: "promote",
        request,
      });
      expect(res.status).toBe(422);
    }
    expect(await s.deployments.list("ai", "prod")).toEqual(before);
    expect((await requests.get(rollback.id))?.status).toBe("dispatched");
  });

  it("GivenARequestAlreadyMatched_WhenAReportReplaysIt_Then422", async () => {
    const requests = new InMemoryReleaseRequestStore();
    const s = setup(undefined, undefined, requests);
    await devBuild(s);
    const request = await asked(requests);
    const body = {
      imageDigest: PROMOTED,
      environment: "prod",
      kind: "promote",
      request: request.id,
    };
    expect((await s.start(release(), body)).status).toBe(201);
    expect((await s.start(release(), body)).status).toBe(422);
  });

  it("GivenTwoStartReportsForOneRequestAtOnce_WhenBothArrive_ThenOnlyOneDeploymentIsRecorded", async () => {
    const requests = new InMemoryReleaseRequestStore();
    const s = setup(undefined, undefined, requests);
    await devBuild(s);
    const request = await asked(requests);
    const body = {
      imageDigest: PROMOTED,
      environment: "prod",
      kind: "promote",
      request: request.id,
    };
    const statuses = (await Promise.all([s.start(release(), body), s.start(release(), body)])).map(
      (r) => r.status,
    );
    expect(statuses.sort()).toEqual([201, 422]);
    expect(
      (await s.deployments.list("ai", "prod")).filter((d) => d.kind === "promote"),
    ).toHaveLength(1);
  });

  it("GivenAReleaseRunByHand_WhenItReportsWithoutARequest_ThenItIsRecordedAsBefore", async () => {
    const requests = new InMemoryReleaseRequestStore();
    const s = setup(undefined, undefined, requests);
    await devBuild(s);
    const res = await s.start(release(), {
      imageDigest: PROMOTED,
      environment: "prod",
      kind: "promote",
    });
    expect(res.status).toBe(201);
  });
});
