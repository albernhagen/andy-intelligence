import {
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryRunnerStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ownerOnlyAccess } from "../project-access";
import { ClientMetadataResolver } from "./client-metadata";
import { mcpCaller, mcpToolNames } from "./test-client";

/**
 * AI-294: list_runners returns what GET /api/runners returns. Register stays web-only on purpose;
 * revoke stays web-only until AI-351: Parity: revoke a runner over MCP.
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
    expect(names).toContain("list_runners");
    expect(names.filter((n) => n.includes("runner") && /register|mint/.test(n))).toEqual([]);
  });
});
