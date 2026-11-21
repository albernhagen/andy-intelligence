import {
  InMemoryOAuthGrantStore,
  InMemoryQuotaStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type QuotaReading,
} from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ownerOnlyAccess } from "../project-access";
import { ClientMetadataResolver } from "./client-metadata";
import { hashToken, newToken } from "./tokens";

/** AI-286: get_quota returns what GET /api/quota returns, through the same service call. */

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

async function setup(quota?: InMemoryQuotaStore) {
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    projectAccess: ownerOnlyAccess(),
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker: new InMemoryWorkTracker(),
    runs: new InMemoryRunStore(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    ...(quota ? { quota } : {}),
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
  const call = async (name: string) => {
    const result = await client.callTool({ name, arguments: {} });
    return { isError: result.isError === true, data: result.structuredContent };
  };
  const rest = async (token = "andy") => {
    const res = await app.request("/api/quota", { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as unknown };
  };
  return { client, call, rest };
}

const reading = (window: "5h" | "weekly", usedPct: number): QuotaReading => ({
  provider: "claude-sub",
  window,
  usedPct,
  resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
  source: "test",
  takenAt: new Date().toISOString(),
  confidence: "high",
});

describe("get_quota (AI-286 parity with GET /api/quota)", () => {
  it("GivenReadingsForBothWindows_WhenReadOverMcpAndRest_ThenTheSameStatus", async () => {
    const quota = new InMemoryQuotaStore();
    await quota.save([reading("5h", 72), reading("weekly", 30)]);
    const { call, rest } = await setup(quota);
    const viaMcp = await call("get_quota");
    const viaRest = await rest();
    expect(viaMcp.isError).toBe(false);
    expect(viaRest.status).toBe(200);
    expect(viaMcp.data).toEqual(viaRest.body);
    expect(viaMcp.data).toMatchObject({ provider: "claude-sub", level: "warn" });
  });

  it("GivenNoQuotaStore_WhenRead_ThenBothSayUnknown", async () => {
    const { call, rest } = await setup();
    const viaMcp = await call("get_quota");
    expect(viaMcp.data).toEqual((await rest()).body);
    expect(viaMcp.data).toMatchObject({ level: "unknown" });
  });

  it("GivenTheToolList_WhenListed_ThenGetQuotaIsReadOnlyAndTakesNoInput", async () => {
    const { client } = await setup();
    const tool = (await client.listTools()).tools.find((t) => t.name === "get_quota");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool?.inputSchema.properties ?? {}).toEqual({});
  });

  it("GivenACallerOffTheAllowList_WhenRest_ThenRefused", async () => {
    const { rest } = await setup();
    expect((await rest("eve")).status).toBe(401);
  });
});
