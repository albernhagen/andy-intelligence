import {
  InMemoryConfigChangeStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ClientMetadataResolver } from "./client-metadata";
import { hashToken, newToken } from "./tokens";
import { ownerOnlyAccess } from "../project-access";

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

/** The app with MCP on, a connected client, and two projects (AI and OPS). */
async function setup() {
  const tracker = new InMemoryWorkTracker();
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    projectAccess: ownerOnlyAccess(),
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    configChanges: new InMemoryConfigChangeStore(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  const token = newToken();
  await grants.put(hashToken(token), {
    kind: "access",
    clientId: "https://claude.ai/oauth/mcp-client-metadata",
    email: "andy@example.com",
    uid: "andy",
    resource: RESOURCE,
    scope: "",
    redirectUri: null,
    codeChallenge: null,
    expiresAt: "2999-01-01T00:00:00.000Z",
  });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(RESOURCE), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (input, init) =>
        app.fetch(input instanceof Request ? input : new Request(input, init)),
    }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { isError: result.isError === true, text, data: result.structuredContent as any };
  };
  const rest = (path: string, body: object) =>
    app.request(path, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
    });
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await tracker.createProject({ name: "Ops", key: "OPS" });
  return { tracker, call, rest };
}

describe("get_project_settings", () => {
  it("GivenSettingsChangedInTheApp_WhenReadOverMcp_ThenEveryFieldIsReturned", async () => {
    const ctx = await setup();
    // Builds is turned on the only way it can be: the app's PATCH (ADR-0063).
    expect((await ctx.rest("/api/projects/ai", { buildEnabled: true })).status).toBe(200);
    await ctx.tracker.updateProject("ai", {
      autoBuild: true,
      planApproval: "m-and-l",
      autoRefine: false,
      dailyQuestionCap: 7,
      autoMerge: "s",
      mergeMode: "epic",
      runsAtOnce: 3,
      paused: true,
      defaultWorker: "ask",
      executor: "local",
      emailNotifications: false,
      environments: "dev-and-prod",
      lastDispatch: { decision: "paused", at: "2026-11-09T12:00:00.000Z" },
    });

    const res = await ctx.call("get_project_settings", { project: "ai" });

    expect(res.isError).toBe(false);
    expect(res.data).toEqual({
      project: "AI",
      name: "Andy Intelligence",
      buildEnabled: true,
      buildEnabledBy: "andy@example.com",
      buildEnabledAt: expect.any(String),
      autoBuild: true,
      planApproval: "m-and-l",
      autoRefine: false,
      dailyQuestionCap: 7,
      mergeMode: "epic",
      suggestedMergeMode: null,
      runsAtOnce: 3,
      paused: true,
      defaultWorker: "ask",
      executor: "local",
      emailNotifications: false,
      environments: "dev-and-prod",
      lastDispatch: { decision: "paused", at: "2026-11-09T12:00:00.000Z" },
    });
  });

  it("GivenTwoProjects_WhenOneIsRead_ThenOnlyItsSettingsComeBack", async () => {
    const ctx = await setup();
    await ctx.tracker.updateProject("ops", { paused: true, runsAtOnce: 4 });

    const res = await ctx.call("get_project_settings", { project: "AI" });

    expect(res.data).toMatchObject({ project: "AI", paused: false, runsAtOnce: 2 });
  });

  it("GivenAnUnknownOrMalformedProject_WhenRead_ThenItIsRefused", async () => {
    const ctx = await setup();
    expect(await ctx.call("get_project_settings", { project: "NOPE" })).toMatchObject({
      isError: true,
      text: "project NOPE not found",
    });
    // A Firestore-style id or path is not a project key: the input schema refuses it.
    expect((await ctx.call("get_project_settings", { project: "../ops" })).isError).toBe(true);
  });

  it("GivenNoBuildsSetter_WhenACallerTriesToTurnBuildsOnOverMcp_ThenItIsRefusedAndNothingChanges", async () => {
    const ctx = await setup();
    const res = await ctx.call("set_build_enabled", { project: "AI", enabled: true });
    expect(res.isError).toBe(true);
    expect((await ctx.tracker.getProject("ai"))?.buildEnabled).toBe(false);
  });
});

describe("set_environments (AI-160)", () => {
  it("GivenAProdOnlyProject_WhenSetToDevAndProd_ThenSavedAndReadBack", async () => {
    const ctx = await setup();
    expect((await ctx.call("get_project_settings", { project: "AI" })).data).toMatchObject({
      environments: "prod-only",
    });

    const res = await ctx.call("set_environments", { project: "ai", environments: "dev-and-prod" });

    expect(res.data).toEqual({ project: "AI", environments: "dev-and-prod" });
    expect((await ctx.tracker.getProject("ai"))?.environments).toBe("dev-and-prod");
    expect((await ctx.tracker.getProject("ops"))?.environments).toBe("prod-only");
  });

  it("GivenAnUnknownPolicyOrProject_WhenSet_ThenRefusedAndNothingChanges", async () => {
    const ctx = await setup();
    expect(
      (await ctx.call("set_environments", { project: "AI", environments: "staging" })).isError,
    ).toBe(true);
    expect(
      (await ctx.call("set_environments", { project: "NOPE", environments: "prod-only" })).isError,
    ).toBe(true);
    expect((await ctx.tracker.getProject("ai"))?.environments).toBe("prod-only");
  });

  it("GivenTheSettingsPageRoute_WhenPatched_ThenTheSameFieldIsSaved", async () => {
    const ctx = await setup();
    expect((await ctx.rest("/api/projects/ai", { environments: "dev-and-prod" })).status).toBe(200);
    expect((await ctx.rest("/api/projects/ai", { environments: "staging" })).status).toBe(400);
    expect((await ctx.tracker.getProject("ai"))?.environments).toBe("dev-and-prod");
  });
});

/** ADR-0124: merge modes, stored only (AI-214). The page's PATCH and MCP share one rule (AI-40). */
describe("set_merge_mode and the settings route", () => {
  const log = async (ctx: Awaited<ReturnType<typeof setup>>, project = "AI") =>
    (await ctx.call("list_settings_changes", { project })).data;

  it("GivenAProjectStoredBeforeTheSetting_WhenRead_ThenNoModeIsInForceAndOneIsSuggested", async () => {
    const ctx = await setup();
    await ctx.tracker.updateProject("ops", { mergeMode: null, autoMerge: "all" });
    await ctx.tracker.updateProject("ai", { mergeMode: null, autoMerge: "none" });

    const ops = (await ctx.call("get_project_settings", { project: "OPS" })).data;
    const ai = (await ctx.call("get_project_settings", { project: "AI" })).data;

    // ADR-0134: nothing merges until a mode is saved; ADR-0124's mapping is only suggested.
    expect(ops).toMatchObject({ mergeMode: null, suggestedMergeMode: "all-clean" });
    expect(ai).toMatchObject({ mergeMode: null, suggestedMergeMode: "all-clean" });
    expect(ops).not.toHaveProperty("autoMerge");
  });

  it("GivenNoModeSaved_WhenOnlyManualCanBeSavedOverMcp_ThenAnythingLooserIsRefused", async () => {
    const ctx = await setup();
    await ctx.tracker.updateProject("ops", { mergeMode: null, autoMerge: "all" });

    const loose = await ctx.call("set_merge_mode", { project: "OPS", mode: "all-clean" });
    expect(loose.isError).toBe(true);
    expect(loose.text).toContain("project settings page");
    expect((await ctx.tracker.getProject("ops"))?.mergeMode).toBeNull();

    expect((await ctx.call("set_merge_mode", { project: "OPS", mode: "manual" })).isError).toBe(
      false,
    );
  });

  it("GivenLowRisk_WhenTightenedToManualOverMcp_ThenSavedAndLogged", async () => {
    const ctx = await setup();

    const res = await ctx.call("set_merge_mode", { project: "ai", mode: "manual" });

    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ project: "AI", mergeMode: "manual" });
    expect((await ctx.tracker.getProject("ai"))?.mergeMode).toBe("manual");
    expect(JSON.stringify(await log(ctx))).toContain("mergeMode");
  });

  it("GivenManual_WhenLoosenedOverMcp_ThenRefusedWithWhereToDoItAndNothingChanges", async () => {
    const ctx = await setup();
    await ctx.call("set_merge_mode", { project: "AI", mode: "manual" });

    const res = await ctx.call("set_merge_mode", { project: "AI", mode: "all-clean" });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("project settings page");
    expect((await ctx.tracker.getProject("ai"))?.mergeMode).toBe("manual");
  });

  it("GivenManual_WhenLoosenedOnTheSettingsPage_ThenSavedAndLogged", async () => {
    const ctx = await setup();
    await ctx.call("set_merge_mode", { project: "AI", mode: "manual" });

    expect((await ctx.rest("/api/projects/ai", { mergeMode: "all-clean" })).status).toBe(200);

    expect((await ctx.tracker.getProject("ai"))?.mergeMode).toBe("all-clean");
    expect((await ctx.rest("/api/projects/ai", { mergeMode: "sometimes" })).status).toBe(400);
  });

  it("GivenALoosenedMode_WhenItsTighteningIsRevertedOverMcp_ThenRefused", async () => {
    const ctx = await setup();
    await ctx.call("set_merge_mode", { project: "AI", mode: "manual" });
    const [change] = (await log(ctx)).changes;

    const res = await ctx.call("revert_settings_change", { project: "AI", id: change.id });

    expect(res.isError).toBe(true);
    expect((await ctx.tracker.getProject("ai"))?.mergeMode).toBe("manual");
  });
});
