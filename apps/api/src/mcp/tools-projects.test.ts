import { InMemoryOAuthGrantStore, InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ClientMetadataResolver } from "./client-metadata";
import { mcpCaller } from "./test-client";
import { hashToken, newToken } from "./tokens";

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;

const verifier: TokenVerifier = {
  async verify() {
    throw new Error("not used");
  },
};

/** The app with MCP on, two projects (AI and OPS) and a few AI tickets. */
async function setup() {
  const tracker = new InMemoryWorkTracker();
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  await tracker.createProject({ name: "Andy Intelligence", key: "AI", repos: ["o/ai"] });
  await tracker.createProject({ name: "Ops", key: "OPS" });
  await tracker.updateProject("ai", { paused: true, runsAtOnce: 3, autoBuild: true });
  await tracker.createTicket("ai", { title: "One" }, "andy");
  const two = await tracker.createTicket("ai", { title: "Two" }, "andy");
  await tracker.updateTicket(
    "ai",
    two.id,
    { stage: { to: "ready", forced: true, reason: "setup" } },
    "andy",
  );
  const gone = await tracker.createTicket("ai", { title: "Gone" }, "andy");
  await tracker.updateTicket(
    "ai",
    gone.id,
    { stage: { to: "done", forced: true, reason: "setup" } },
    "andy",
  );
  await tracker.updateTicket("ai", gone.id, { fields: { archived: true } }, "andy");
  return { app, tracker, grants };
}

/** A raw tools/call for list_projects with the given bearer token. */
function rawCall(app: ReturnType<typeof createApp>, token: string) {
  return app.request(RESOURCE, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_projects", arguments: {} },
    }),
  });
}

describe("list_projects", () => {
  it("GivenTwoProjects_WhenListed_ThenEachHasItsSettingsAndUnarchivedStageCounts", async () => {
    const ctx = await setup();
    const call = await mcpCaller(ctx.app, ctx.grants, RESOURCE);

    const result = await call("list_projects");

    expect(result.isError).toBe(false);
    const byKey = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON from the tool
      result.data.projects.map((p: any) => [p.key, p]),
    );
    expect(Object.keys(byKey).sort()).toEqual(["AI", "OPS"]);
    expect(byKey.AI).toMatchObject({
      name: "Andy Intelligence",
      repos: ["o/ai"],
      enabled: true,
      paused: true,
      runsAtOnce: 3,
      autoBuild: true,
    });
    // The archived Done ticket is not counted.
    expect(byKey.AI.ticketsByStage).toMatchObject({ backlog: 1, ready: 1, done: 0 });
    expect(Object.values(byKey.OPS.ticketsByStage).every((n) => n === 0)).toBe(true);
  });

  it("GivenListProjects_WhenCalled_ThenNoDataChanges", async () => {
    const ctx = await setup();
    const call = await mcpCaller(ctx.app, ctx.grants, RESOURCE);
    const snapshot = async () => ({
      projects: await ctx.tracker.listProjects(),
      tickets: await ctx.tracker.listTickets("ai"),
      events: await Promise.all(
        (await ctx.tracker.listTickets("ai")).map((t) => ctx.tracker.listEvents("ai", t.id)),
      ),
    });
    const before = await snapshot();

    await call("list_projects");

    expect(await snapshot()).toEqual(before);
  });

  it("GivenNoValidToken_WhenListProjectsIsCalled_Then401", async () => {
    const ctx = await setup();

    expect((await rawCall(ctx.app, newToken())).status).toBe(401);
  });

  it("GivenATokenForAnEmailNotOnTheAllowList_WhenListProjectsIsCalled_Then401", async () => {
    const ctx = await setup();
    const token = newToken();
    await ctx.grants.put(hashToken(token), {
      kind: "access",
      clientId: "https://claude.ai/oauth/mcp-client-metadata",
      email: "stranger@example.com",
      uid: "stranger",
      resource: RESOURCE,
      scope: "",
      redirectUri: null,
      codeChallenge: null,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });

    expect((await rawCall(ctx.app, token)).status).toBe(401);
  });
});
