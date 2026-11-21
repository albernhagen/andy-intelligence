import { InMemoryOAuthGrantStore, InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ownerOnlyAccess } from "../project-access";
import { ClientMetadataResolver } from "./client-metadata";
import { mcpCaller } from "./test-client";

/** AI-297: create_project creates a project as POST /api/projects does, with the same refusals. */

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
  const runs = new InMemoryRunStore();
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    projectAccess: ownerOnlyAccess(),
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs,
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  const call = await mcpCaller(app, grants, RESOURCE);
  const rest = async (body: object) => {
    const res = await app.request("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { tracker, runs, call, rest };
}

/** What both sides return, without the fields that differ per write (id, times). */
const comparable = (p: Record<string, unknown>) => {
  const { createdAt: _c, updatedAt: _u, ...rest } = p;
  void _c;
  void _u;
  return rest;
};

describe("create_project (AI-297 parity with POST /api/projects)", () => {
  it("GivenAKeyAndName_WhenCreatedOverMcpAndRest_ThenTheSameProjectShapeAndNothingRuns", async () => {
    const { tracker, runs, call, rest } = await setup();
    const viaRest = await rest({ key: "WEB", name: "Website" });
    const viaMcp = await call("create_project", { key: "OPS", name: "Website" });
    expect(viaRest.status).toBe(201);
    expect(viaMcp.isError).toBe(false);
    const norm = (p: Record<string, unknown>) => ({ ...comparable(p), id: "x", key: "X" });
    expect(norm(viaMcp.data)).toEqual(norm(viaRest.body));
    expect(viaMcp.data).toMatchObject({ key: "OPS", name: "Website", repos: [] });
    expect((await tracker.listProjects()).map((p) => p.key).sort()).toEqual(["OPS", "WEB"]);
    // It only stores the project: no agent task starts.
    expect(await runs.listActive("ops")).toEqual([]);
  });

  it("GivenATakenKey_WhenCreated_ThenBothRefuseWithTheSameReason", async () => {
    const { call, rest } = await setup();
    await rest({ key: "WEB", name: "Website" });
    const viaRest = await rest({ key: "WEB", name: "Again" });
    const viaMcp = await call("create_project", { key: "WEB", name: "Again" });
    expect(viaRest.status).toBeGreaterThanOrEqual(400);
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toBe(viaRest.body.error);
  });

  it("GivenAnInvalidRepo_WhenCreated_ThenBothRefuseWithTheSameReason", async () => {
    const { tracker, call, rest } = await setup();
    const viaRest = await rest({ key: "WEB", name: "Website", repos: ["not a repo"] });
    const viaMcp = await call("create_project", {
      key: "WEB",
      name: "Website",
      repos: ["not a repo"],
    });
    expect(viaRest.status).toBe(422);
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toBe(viaRest.body.error);
    expect(await tracker.listProjects()).toEqual([]);
  });

  it("GivenAnInvalidKey_WhenCreated_ThenBothRefuseAndNothingIsCreated", async () => {
    const { tracker, call, rest } = await setup();
    expect((await rest({ key: "web site", name: "Website" })).status).toBe(400);
    expect((await call("create_project", { key: "web site", name: "Website" })).isError).toBe(true);
    expect(await tracker.listProjects()).toEqual([]);
  });
});
