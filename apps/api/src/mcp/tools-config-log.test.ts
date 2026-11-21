import {
  InMemoryConfigChangeStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
/* eslint-disable @typescript-eslint/no-explicit-any -- assertions read the JSON freely */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    configChanges: new InMemoryConfigChangeStore(),
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
    return { isError: result.isError === true, text, data: result.structuredContent as any };
  };
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  // The REST route as the settings page calls it, for "the same list as the API".
  const rest = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { call, rest };
}

/** M4.12: the change-log tools use the same ConfigRevert rules as REST and the settings page. */
describe("settings change log tools", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-12T10:00:00.000Z") });
  });
  afterEach(() => vi.useRealTimers());

  it("GivenAFlip_WhenListedOverMcp_ThenTheSameListAsTheApi", async () => {
    const ctx = await setup();
    await ctx.rest("PATCH", "/api/projects/ai", { paused: true });

    const listed = await ctx.call("list_settings_changes", { project: "ai" });
    const api = await ctx.rest("GET", "/api/projects/ai/config-changes");

    expect(api.status).toBe(200);
    expect(listed.data.changes).toEqual(api.json);
    expect(listed.data.changes).toMatchObject([
      { status: "applied", diff: { paused: { from: false, to: true } } },
    ]);
  });

  it("GivenAFlip_WhenRevertedOverMcp_ThenTheSettingIsBackAndTheRevertIsLogged", async () => {
    const ctx = await setup();
    await ctx.rest("PATCH", "/api/projects/ai", { paused: true });
    const [flip] = (await ctx.call("list_settings_changes", { project: "AI" })).data.changes;

    vi.setSystemTime(Date.now() + 1000);
    const reverted = await ctx.call("revert_settings_change", { project: "AI", id: flip.id });
    const again = await ctx.call("revert_settings_change", { project: "AI", id: flip.id });
    const after = (await ctx.call("list_settings_changes", { project: "AI" })).data.changes;

    expect(reverted.data).toMatchObject({
      project: { paused: false },
      reverted: { id: flip.id, status: "reverted", decidedBy: "user:andy" },
    });
    expect(again.isError).toBe(true);
    expect(after).toMatchObject([
      { reason: `Revert of ${flip.id}`, status: "applied" },
      { id: flip.id, status: "reverted" },
    ]);
  });

  it("GivenABuildsChange_WhenRevertedOverMcp_ThenRefusedAsBuildsIsSetOnlyInTheApp", async () => {
    const ctx = await setup();
    await ctx.rest("PATCH", "/api/projects/ai", { buildEnabled: true });
    const [flip] = (await ctx.call("list_settings_changes", { project: "AI" })).data.changes;

    const refused = await ctx.call("revert_settings_change", { project: "AI", id: flip.id });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("only in the app");
  });
});
