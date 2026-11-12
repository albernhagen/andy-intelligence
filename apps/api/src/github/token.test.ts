import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { CLAUDE_EXECUTOR_REF } from "@andy/github";
import { REPO, createdApp, githubApp, repo } from "./test-app";
import {
  ACTIONS_ISSUER,
  TOKEN_PATH,
  TOKEN_POLICY,
  TOKEN_RATE_LIMIT,
  actionsTokenVerifier,
  executorEntry,
  type ActionsClaims,
} from "./token";

const allowed = TOKEN_POLICY[0]!;

/** Stand-in for Actions OIDC verification: the bearer is the JSON of its claims. */
const verify = async (jwt: string): Promise<ActionsClaims> => {
  if (!jwt.startsWith("{")) throw new Error("bad signature");
  return JSON.parse(jwt) as ActionsClaims;
};

async function setup(connected = true) {
  const t = githubApp({ verifyActionsToken: verify });
  if (connected) await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const mint = (claims: ActionsClaims | string | null) =>
    t.call(
      TOKEN_PATH,
      { method: "POST" },
      claims === null ? null : typeof claims === "string" ? claims : JSON.stringify(claims),
    );
  return { ...t, mint };
}

describe("repo token endpoint", () => {
  it("GivenTheSystemReviewWorkflowOnMain_WhenItAsks_ThenItGetsATokenForItsRepo", async () => {
    const { mint } = await setup();
    const res = await mint(allowed);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      token: `fake-token-${REPO}`,
      actor: "fake-app[bot]",
    });
  });

  it("GivenNoOrAnInvalidToken_WhenAsking_Then401", async () => {
    const { mint } = await setup();
    expect((await mint(null)).status).toBe(401);
    expect((await mint("forged")).status).toBe(401);
  });

  it("GivenTheSameWorkflowOnAnotherBranch_WhenAsking_Then403", async () => {
    const { mint } = await setup();
    const res = await mint({
      ...allowed,
      workflow_ref: allowed.workflow_ref.replace("refs/heads/main", "refs/heads/evil"),
    });
    expect(res.status).toBe(403);
  });

  it("GivenAnotherWorkflowOrRepo_WhenAsking_Then403", async () => {
    const { mint } = await setup();
    expect(
      (
        await mint({
          ...allowed,
          workflow_ref: allowed.workflow_ref.replace("system-security-review", "ci"),
        })
      ).status,
    ).toBe(403);
    expect((await mint({ ...allowed, repository: "someone/else" })).status).toBe(403);
  });

  it("GivenGitHubIsNotConnected_WhenAsking_Then503", async () => {
    const { mint } = await setup(false);
    expect((await mint(allowed)).status).toBe(503);
  });

  it("GivenTheAppIsNotInstalledOnTheRepo_WhenAsking_Then403", async () => {
    const { mint, host } = await setup();
    host.uninstall(REPO);
    expect((await mint(allowed)).status).toBe(403);
  });

  it("GivenManyRequests_WhenOverTheCap_Then429", async () => {
    const { mint } = await setup();
    for (let i = 0; i < TOKEN_RATE_LIMIT; i++) await mint(allowed);
    expect((await mint(allowed)).status).toBe(429);
  });

  it("GivenUnauthenticatedFloods_WhenTheWorkflowAsks_ThenItStillGetsAToken", async () => {
    const { mint } = await setup();
    for (let i = 0; i < TOKEN_RATE_LIMIT + 5; i++) await mint("forged");
    expect((await mint(allowed)).status).toBe(200);
  });
});

describe("actionsTokenVerifier", () => {
  async function keys() {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
    const jwks = createLocalJWKSet({ keys: [jwk] });
    const sign = (
      claims: Record<string, unknown>,
      opts: { iss?: string; aud?: string; exp?: string } = {},
    ) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(opts.iss ?? ACTIONS_ISSUER)
        .setAudience(opts.aud ?? "https://cp.example")
        .setIssuedAt()
        .setExpirationTime(opts.exp ?? "5m")
        .sign(privateKey);
    return { verify: actionsTokenVerifier("https://cp.example", jwks), sign };
  }

  it("GivenAGenuineActionsToken_WhenVerified_ThenItsClaimsAreReturned", async () => {
    const { verify, sign } = await keys();
    expect(await verify(await sign({ ...allowed, ref: "refs/heads/main" }))).toEqual(allowed);
  });

  it("GivenTheWrongAudienceIssuerOrAnExpiredToken_WhenVerified_ThenItThrows", async () => {
    const { verify, sign } = await keys();
    await expect(
      verify(await sign({ ...allowed }, { aud: "https://other.example" })),
    ).rejects.toThrow();
    await expect(
      verify(await sign({ ...allowed }, { iss: "https://evil.example" })),
    ).rejects.toThrow();
    await expect(verify(await sign({ ...allowed }, { exp: "1s ago" }))).rejects.toThrow();
  });

  it("GivenATokenWithoutWorkflowClaims_WhenVerified_ThenItThrows", async () => {
    const { verify, sign } = await keys();
    await expect(verify(await sign({ repository: REPO }))).rejects.toThrow();
  });
});

describe("repo token endpoint: executor publish job (ADR-0063, ADR-0096)", () => {
  const OTHER = "albernhagen/managed";
  const claims = (repository = REPO, extra: Partial<ActionsClaims> = {}): ActionsClaims => ({
    repository,
    workflow_ref: `${repository}/.github/workflows/agent-run.yml@refs/heads/main`,
    job_workflow_ref: CLAUDE_EXECUTOR_REF,
    run_id: "1",
    ...extra,
  });
  async function setupWith(projects: { key: string; repos: string[] }[]) {
    const t = githubApp({ verifyActionsToken: verify });
    t.host.install(repo(OTHER));
    await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
    for (const p of projects) {
      await t.tracker.createProject({ name: p.key, key: p.key, repos: p.repos });
    }
    const ask = (c: ActionsClaims, body: unknown) =>
      t.call(TOKEN_PATH, { method: "POST", body: JSON.stringify(body) }, JSON.stringify(c));
    return { ...t, ask };
  }

  it("GivenTheExecutorWithoutARunId_WhenAsking_Then403", async () => {
    const { ask } = await setupWith([{ key: "AI", repos: [REPO] }]);
    expect((await ask(claims(), {})).status).toBe(403);
  });

  it("GivenTheCallerWorkflowButAnotherReusableWorkflow_WhenAsking_Then403", async () => {
    const { ask } = await setupWith([{ key: "AI", repos: [REPO] }]);
    const other = claims(REPO, {
      job_workflow_ref: `${REPO}/.github/workflows/evil.yml@refs/heads/main`,
    });
    expect((await ask(other, { runId: "r1" })).status).toBe(403);
  });

  it("GivenARegisteredReposExecutorForAnUnknownRun_WhenAsking_ThenTheRunIsChecked404", async () => {
    const { ask } = await setupWith([
      { key: "AI", repos: [REPO] },
      { key: "MG", repos: [OTHER] },
    ]);
    expect((await ask(claims(), { runId: "nope" })).status).toBe(404);
    expect((await ask(claims(OTHER), { runId: "nope" })).status).toBe(404);
  });

  it("GivenAnUnregisteredRepoRunningTheExecutor_WhenAsking_Then403", async () => {
    const { ask } = await setupWith([{ key: "AI", repos: [REPO] }]);
    expect((await ask(claims(OTHER), { runId: "r1" })).status).toBe(403);
  });

  it("GivenADisabledProjectsRepo_WhenTheRuleIsChecked_ThenNoEntry", async () => {
    const { tracker } = await setupWith([{ key: "MG", repos: [OTHER] }]);
    const [project] = await tracker.listProjects();
    expect(await executorEntry(claims(OTHER), async () => project!)).toMatchObject({
      runGrant: true,
    });
    expect(
      await executorEntry(claims(OTHER), async () => ({ ...project!, enabled: false })),
    ).toBeNull();
  });

  it("GivenARegisteredRepoButAnotherCallerFileOrBranch_WhenAsking_Then403", async () => {
    const { ask } = await setupWith([{ key: "MG", repos: [OTHER] }]);
    for (const workflow_ref of [
      `${OTHER}/.github/workflows/ci.yml@refs/heads/main`,
      `${OTHER}/.github/workflows/agent-run.yml@refs/heads/evil`,
      `${REPO}/.github/workflows/agent-run.yml@refs/heads/main`,
    ]) {
      expect((await ask(claims(OTHER, { workflow_ref }), { runId: "r1" })).status).toBe(403);
    }
  });

  it("GivenTheExecutorAtAnotherRef_WhenAsking_Then403", async () => {
    const { ask } = await setupWith([{ key: "MG", repos: [OTHER] }]);
    const pinned = CLAUDE_EXECUTOR_REF.replace("refs/heads/main", "refs/heads/dev");
    expect((await ask(claims(OTHER, { job_workflow_ref: pinned }), { runId: "r1" })).status).toBe(
      403,
    );
  });
});
