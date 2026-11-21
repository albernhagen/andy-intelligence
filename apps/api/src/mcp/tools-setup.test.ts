import { InMemoryOAuthGrantStore, InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ownerOnlyAccess, type ProjectAccess } from "../project-access";
import { ClientMetadataResolver } from "./client-metadata";
import { mcpCaller, mcpTools } from "./test-client";

/** AI-287: project_setup returns what GET /api/projects/{id}/setup returns, from one reader. */

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

async function setup(projectAccess: ProjectAccess = ownerOnlyAccess()) {
  const tracker = new InMemoryWorkTracker();
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    projectAccess,
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
  const call = await mcpCaller(app, grants, RESOURCE);
  const rest = async (projectId: string) => {
    const res = await app.request(`/api/projects/${projectId}/setup`, {
      headers: { authorization: "Bearer andy" },
    });
    return { status: res.status, body: (await res.json()) as unknown };
  };
  return { app, grants, call, rest };
}

describe("project_setup (AI-287 parity with GET /api/projects/{id}/setup)", () => {
  it("GivenProjectsWithAndWithoutARepo_WhenReadOverMcpAndRest_ThenTheSameChecklist", async () => {
    const { call, rest } = await setup();
    for (const [key, id] of [
      ["AI", "ai"],
      ["ops", "ops"],
    ] as const) {
      const viaMcp = await call("project_setup", { project: key });
      const viaRest = await rest(id);
      expect(viaMcp.isError).toBe(false);
      expect(viaRest.status).toBe(200);
      expect(viaMcp.data).toEqual(viaRest.body);
    }
  });

  it("GivenAnUnknownProject_WhenRead_ThenBothRefuseAsNotFound", async () => {
    const { call, rest } = await setup();
    expect((await rest("nope")).status).toBe(404);
    const viaMcp = await call("project_setup", { project: "NOPE" });
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toMatch(/not found/i);
  });

  it("GivenAProjectTheCallerCantRead_WhenRead_ThenBothRefuseAsNotFound", async () => {
    const { call, rest } = await setup({ canRead: async (_actor, id) => id !== "ai" });
    expect((await rest("ai")).status).toBe(404);
    const viaMcp = await call("project_setup", { project: "AI" });
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toMatch(/not found/i);
    expect((await call("project_setup", { project: "OPS" })).isError).toBe(false);
  });

  it("GivenTheToolList_WhenListed_ThenProjectSetupIsThereAndSaysItNeverDoesAStep", async () => {
    const { app, grants } = await setup();
    const tool = (await mcpTools(app, grants, RESOURCE)).find((t) => t.name === "project_setup");
    expect(tool?.description).toMatch(/Read-only: it never does a step/);
  });
});
