import {
  InMemoryNotifyLedger,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "../app";
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

/** AI-77: set_email_notifications. The app with MCP on, a connected client, and two projects (AI and OPS). */
async function setup(email?: AppDeps["email"]) {
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
    email,
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
  /** POST /api/notify/email/test as Andy (AI-289 parity). */
  const restTest = async () => {
    const res = await app.request("/api/notify/email/test", {
      method: "POST",
      headers: { authorization: "Bearer andy" },
    });
    return { status: res.status, body: (await res.json()) as { error?: string; sent?: true } };
  };
  return { tracker, call, rest, restTest };
}

describe("set_email_notifications", () => {
  it("GivenEmailIsNotConfigured_WhenTurnedOff_ThenSavedAndItSaysNotConfigured", async () => {
    const ctx = await setup();
    const res = await ctx.call("set_email_notifications", { project: "ai", enabled: false });
    expect(res.data).toEqual({ project: "AI", emailNotifications: false, emailConfigured: false });
    expect((await ctx.tracker.getProject("ai"))?.emailNotifications).toBe(false);
    expect((await ctx.call("get_project_settings", { project: "AI" })).data).toMatchObject({
      emailNotifications: false,
    });
  });

  it("GivenEmailIsConfigured_WhenTurnedOn_ThenItSaysConfigured", async () => {
    const ctx = await setup({
      notifier: { notify: async () => {} },
      ledger: new InMemoryNotifyLedger(),
      flushQueue: null,
      appUrl: PUBLIC_URL,
    });
    await ctx.tracker.updateProject("ops", { emailNotifications: false });
    const res = await ctx.call("set_email_notifications", { project: "OPS", enabled: true });
    expect(res.data).toEqual({ project: "OPS", emailNotifications: true, emailConfigured: true });
  });

  it("GivenAnUnknownProject_WhenSet_ThenAnError", async () => {
    const ctx = await setup();
    const res = await ctx.call("set_email_notifications", { project: "NOPE", enabled: true });
    expect(res.isError).toBe(true);
  });
});

describe("test_email (AI-289 parity with POST /api/notify/email/test)", () => {
  const configured = (
    notify: () => Promise<void> = async () => {},
    ledger = new InMemoryNotifyLedger(),
  ) => ({
    notifier: { notify },
    ledger,
    flushQueue: null,
    appUrl: PUBLIC_URL,
  });

  it("GivenEmailIsNotConfigured_WhenTested_ThenBothRefuseWithTheSameReason", async () => {
    const ctx = await setup();
    const viaRest = await ctx.restTest();
    const viaMcp = await ctx.call("test_email");
    expect(viaRest.status).toBe(409);
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toBe(viaRest.body.error);
    expect(viaMcp.text).toBe("email is not configured");
  });

  it("GivenEmailIsConfigured_WhenTested_ThenBothSendOneEmailEach", async () => {
    let sent = 0;
    const ctx = await setup(configured(async () => void sent++));
    expect((await ctx.restTest()).body).toEqual({ sent: true });
    const viaMcp = await ctx.call("test_email");
    expect(viaMcp.data).toEqual({ sent: true, emailConfigured: true });
    expect(sent).toBe(2);
  });

  it("GivenTodaysCapIsUsed_WhenTested_ThenBothRefuseWithTheSameReasonAndNothingIsSent", async () => {
    let sent = 0;
    const ledger = new InMemoryNotifyLedger();
    const day = new Date().toISOString().slice(0, 10);
    await ledger.update(() => ({
      state: {
        day,
        sent: 20,
        overflowSent: false,
        pending: [],
        pendingExtra: 0,
        windowEndsAt: null,
      },
      result: null,
    }));
    const ctx = await setup(configured(async () => void sent++, ledger));
    const viaRest = await ctx.restTest();
    const viaMcp = await ctx.call("test_email");
    expect(viaRest.status).toBe(409);
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toBe(viaRest.body.error);
    expect(viaMcp.text).toBe("today's 20 emails are used");
    expect(sent).toBe(0);
  });

  it("GivenTheProviderRefuses_WhenTested_ThenBothRefuseWithTheProvidersReason", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = await setup(
      configured(async () => {
        throw new Error("domain not verified");
      }),
    );
    const viaRest = await ctx.restTest();
    const viaMcp = await ctx.call("test_email");
    logs.mockRestore();
    expect(viaRest.status).toBe(502);
    expect(viaMcp.text).toBe(viaRest.body.error);
    expect(viaMcp.text).toBe("test email not sent: domain not verified");
  });
});
