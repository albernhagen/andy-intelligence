import {
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryRunnerStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { RunnerService } from "@andy/domain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ownerOnlyAccess } from "../project-access";
import { runnerCredentials } from "../runners";
import { ClientMetadataResolver } from "./client-metadata";
import { mcpCaller, mcpToolNames } from "./test-client";
import { run, type ToolDeps } from "./tools";
import { registerRunnerTools } from "./tools-runners";

/**
 * AI-294: list_runners returns what GET /api/runners returns. AI-351: revoke_runner does what
 * POST /api/runners/:runnerId/revoke does (ADR-0143). Register stays web-only on purpose.
 */

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

/** What MCP deliberately doesn't have, with why (recorded for AI-300's registry test). */
export const RUNNER_ACTIONS_WEB_ONLY = {
  register:
    "POST /api/runners shows the runner secret once; a secret must not land in a chat transcript.",
} as const;

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
    runners: new InMemoryRunnerStore(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  const call = await mcpCaller(app, grants, RESOURCE);
  const rest = async (method: string, path: string, body?: object) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, body: (await res.json()) as any };
  };
  return { app, grants, call, rest };
}

describe("list_runners (AI-294 parity with GET /api/runners)", () => {
  it("GivenARegisteredAndARevokedRunner_WhenListedOverMcpAndRest_ThenTheSameRunnersAndNoSecret", async () => {
    const { call, rest } = await setup();
    const minted = await rest("POST", "/api/runners", { name: "Mac", projectIds: ["ai"] });
    expect(minted.status).toBe(201);
    const second = await rest("POST", "/api/runners", { name: "Old Mac", projectIds: ["ai"] });
    await rest("POST", `/api/runners/${second.body.runner.id}/revoke`);
    const viaRest = await rest("GET", "/api/runners");
    const viaMcp = await call("list_runners");
    expect(viaMcp.isError).toBe(false);
    expect(viaMcp.data.runners).toEqual(viaRest.body);
    expect(viaMcp.data.runners.map((r: { state: string }) => r.state).sort()).toEqual([
      "active",
      "revoked",
    ]);
    expect(viaMcp.text).not.toContain(minted.body.secret);
    expect(viaMcp.text).not.toContain(second.body.secret);
  });

  it("GivenNoRunners_WhenListed_ThenBothEmpty", async () => {
    const { call, rest } = await setup();
    expect((await call("list_runners")).data).toEqual({ runners: [] });
    expect((await rest("GET", "/api/runners")).body).toEqual([]);
  });

  it("GivenTheToolList_WhenListed_ThenRegisteringARunnerIsWebOnlyOnPurpose", async () => {
    const { app, grants } = await setup();
    const names = await mcpToolNames(app, grants, RESOURCE);
    expect(names).toEqual(expect.arrayContaining(["list_runners", "revoke_runner"]));
    expect(names.filter((n) => n.includes("runner") && /register|mint/.test(n))).toEqual([]);
  });
});

describe("revoke_runner (AI-351 parity with POST /api/runners/:runnerId/revoke)", () => {
  it("GivenAnActiveRunner_WhenTheOwnerRevokesOverMcp_ThenRevokedAsViaTheRouteAndLogged", async () => {
    const { call, rest } = await setup();
    const viaMcpRunner = await rest("POST", "/api/runners", { name: "Mac", projectIds: ["ai"] });
    const viaRestRunner = await rest("POST", "/api/runners", { name: "Mini", projectIds: ["ai"] });
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});

    const viaMcp = await call("revoke_runner", { runnerId: viaMcpRunner.body.runner.id });
    const viaRest = await rest("POST", `/api/runners/${viaRestRunner.body.runner.id}/revoke`);

    const revokedLogs = logs.mock.calls
      .map(([line]) => JSON.parse(String(line)) as { message?: string; runnerId?: string })
      .filter((l) => l.message === "runner revoked");
    logs.mockRestore();
    expect(viaMcp.isError).toBe(false);
    expect(viaRest.status).toBe(200);
    expect(viaMcp.data.runner).toMatchObject({ id: viaMcpRunner.body.runner.id, state: "revoked" });
    // The same view as the route's: same fields, revoked, a revocation time.
    expect(Object.keys(viaMcp.data.runner).sort()).toEqual(Object.keys(viaRest.body).sort());
    expect(viaRest.body).toMatchObject({ state: "revoked", revokedAt: expect.any(String) });
    expect(viaMcp.data.runner.revokedAt).toEqual(expect.any(String));
    expect(revokedLogs.map((l) => l.runnerId)).toEqual([
      viaMcpRunner.body.runner.id,
      viaRestRunner.body.runner.id,
    ]);
    const listed = (await rest("GET", "/api/runners")).body as { id: string; state: string }[];
    expect(listed.find((r) => r.id === viaMcpRunner.body.runner.id)?.state).toBe("revoked");
    expect(viaMcp.text).not.toContain(viaMcpRunner.body.secret);
  });

  it("GivenARevokedRunner_WhenItsSecretClaims_ThenRefused", async () => {
    const { app, call, rest } = await setup();
    const minted = await rest("POST", "/api/runners", { name: "Mac", projectIds: ["ai"] });
    await call("revoke_runner", { runnerId: minted.body.runner.id });
    const claim = await app.request("/runner/claim", {
      method: "POST",
      headers: {
        authorization: `Bearer ${minted.body.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(claim.status).toBe(401);
  });

  it("GivenAnUnknownRunnerId_WhenRevokedOverMcpAndRest_ThenBothNotFound", async () => {
    const { call, rest } = await setup();
    const viaMcp = await call("revoke_runner", { runnerId: "no-such-runner" });
    const viaRest = await rest("POST", "/api/runners/no-such-runner/revoke");
    expect(viaRest.status).toBe(404);
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toBe(viaRest.body.error);
  });

  it("GivenAMalformedRunnerId_WhenRevokedOverMcp_ThenRefusedBeforeTheStore", async () => {
    const { call } = await setup();
    const res = await call("revoke_runner", { runnerId: "../x" });
    expect(res.isError).toBe(true);
  });

  it("GivenACallerWhoIsNotTheOwner_WhenRevokingOverMcp_ThenRefusedAndTheRunnerStaysActive", async () => {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    const runners = new RunnerService(new InMemoryRunnerStore(), tracker, runnerCredentials);
    const { runner } = await runners.mint({ name: "Mac", projectIds: ["ai"] }, "user:andy");
    const server = new McpServer({ name: "test", version: "1" });
    registerRunnerTools(server, { runners, actor: "agent:r1" } as unknown as ToolDeps, run);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);

    const res = await client.callTool({
      name: "revoke_runner",
      arguments: { runnerId: runner.id },
    });

    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0]?.text).toBe(
      "only the owner can revoke a local runner",
    );
    expect((await runners.list())[0]?.state).toBe("active");
  });
});
