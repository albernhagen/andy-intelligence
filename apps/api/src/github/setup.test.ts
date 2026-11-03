import { describe, expect, it } from "vitest";
import { PUBLIC_URL, REPO, createdApp, githubApp } from "./test-app";

const connect = (call: ReturnType<typeof githubApp>["call"], code = "abc123") =>
  call("/api/github/connect", { method: "POST", body: JSON.stringify({ code }) });

describe("GitHub setup", () => {
  it("GivenNothingConnected_WhenStatusIsRead_ThenNotConnected", async () => {
    const { call } = githubApp();
    expect(await (await call("/api/github")).json()).toEqual({
      connected: false,
      slug: null,
      owner: null,
      installUrl: null,
      repos: [],
    });
  });

  it("GivenNoSignIn_WhenSetupIsCalled_Then401", async () => {
    const { call } = githubApp();
    expect((await call("/api/github", {}, null)).status).toBe(401);
    expect((await connect((p, i) => call(p, i, null))).status).toBe(401);
  });

  it("GivenNothingConnected_WhenTheManifestIsRequested_ThenItPointsAtThisService", async () => {
    const { call } = githubApp();
    const res = await call("/api/github/manifest?name=my-app");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { postUrl: string; manifest: Record<string, unknown> };
    expect(body.postUrl).toBe("https://github.com/settings/apps/new");
    expect(body.manifest).toMatchObject({
      name: "my-app",
      hook_attributes: { url: `${PUBLIC_URL}/webhooks/github` },
      redirect_url: `${PUBLIC_URL}/settings/github/callback`,
    });
  });

  it("GivenABadAppName_WhenTheManifestIsRequested_Then400", async () => {
    const { call } = githubApp();
    expect((await call("/api/github/manifest?name=%3Cscript%3E")).status).toBe(400);
  });

  it("GivenACode_WhenConnecting_ThenTheAppIsSavedAndItsReposShown", async () => {
    const { call, connections } = githubApp();
    const res = await connect(call);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      connected: true,
      slug: "andy-intelligence",
      installUrl: "https://github.com/apps/andy-intelligence/installations/new",
      repos: [{ fullName: REPO }],
    });
    expect(await connections.get()).toMatchObject({ ...createdApp });
  });

  it("GivenAConnection_WhenConnectingAgainOrAskingForAManifest_Then409", async () => {
    const { call } = githubApp();
    await connect(call);
    expect((await connect(call)).status).toBe(409);
    expect((await call("/api/github/manifest")).status).toBe(409);
  });

  it("GivenGitHubRejectsTheCode_WhenConnecting_Then422AndNothingIsSaved", async () => {
    const { call, connections } = githubApp({
      exchangeCode: async () => {
        throw Object.assign(new Error("Not Found"), { status: 404 });
      },
    });
    expect((await connect(call)).status).toBe(422);
    expect(await connections.get()).toBeNull();
  });

  it("GivenAMalformedCode_WhenConnecting_Then400", async () => {
    const { call } = githubApp();
    expect((await connect(call, "../../x")).status).toBe(400);
  });

  it("GivenAConnection_WhenAProjectIsCreatedWithAnInstalledRepo_ThenItIsAccepted", async () => {
    const { call } = githubApp();
    const create = () =>
      call("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "AI", key: "AI", repos: [REPO] }),
      });
    expect((await create()).status).toBe(422); // not connected yet
    await connect(call);
    expect((await create()).status).toBe(201);
  });
});
