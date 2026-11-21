import {
  InMemoryDeploymentStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { parseAllowList, type TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";

/** AI-295: Parity: dashboards and DORA metrics over MCP. `dashboard` returns what the routes do. */

const PUBLIC_URL = "https://control-plane.example.run.app";
const NOW = new Date("2026-11-19T12:00:00.000Z");
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "andy") return { uid: "andy", email: "andy@example.com", emailVerified: true };
    throw new Error("bad token");
  },
};
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

async function setup(canRead: (projectId: string) => boolean = () => true) {
  const tracker = new InMemoryWorkTracker();
  const deployments = new InMemoryDeploymentStore();
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await tracker.createProject({ name: "Ops", key: "OPS" });
  for (const title of ["Board", "Inbox"]) {
    await tracker.createTicket("ai", { type: "feature", title, size: "S" }, "andy");
  }
  await tracker.createTicket("ops", { type: "chore", title: "Backups" }, "andy");
  for (const days of [2, 9]) {
    await deployments.record({
      projectId: "ai",
      environment: "prod",
      imageDigest: `sha256:${"a".repeat(64)}`,
      gitSha: "b".repeat(40),
      kind: "deploy",
      status: "succeeded",
      startedAt: daysAgo(days),
      finishedAt: daysAgo(days),
      actor: "system",
    });
  }
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    projectAccess: { canRead: (_actor, id) => Promise.resolve(canRead(id)) },
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    deployments,
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  const get = async (path: string) => {
    const res = await app.request(path, { headers: { authorization: "Bearer andy" } });
    return { status: res.status, body: (await res.json()) as unknown };
  };
  const call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
  return { get, call };
}

describe("dashboard parity (AI-295)", () => {
  beforeEach(() => {
    // Only Date is faked, so both sides compute the same week windows; timers still run.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("GivenNoProject_WhenReadOverRestAndMcp_ThenBothReturnTheAllProjectsDashboard", async () => {
    const { get, call } = await setup();
    const rest = await get("/api/dashboard?weeks=4");
    expect(rest.status).toBe(200);
    const tool = await call("dashboard", { weeks: 4 });
    expect(tool.isError).toBe(false);
    expect(tool.data).toEqual(rest.body);
  });

  it("GivenAProject_WhenReadOverMcp_ThenItIsTheProjectDashboardAndDoraRoutesTogether", async () => {
    const { get, call } = await setup();
    const dashboard = await get("/api/projects/ai/dashboard");
    const dora = await get("/api/projects/ai/dora");
    expect(dashboard.status).toBe(200);
    expect(dora.status).toBe(200);
    const tool = await call("dashboard", { project: "ai" });
    expect(tool.data).toEqual({ dashboard: dashboard.body, dora: dora.body });
  });

  it("GivenAProjectTheCallerMayNotRead_WhenReadWithoutAProject_ThenBothSidesLeaveItOut", async () => {
    const { get, call } = await setup((id) => id !== "ops");
    const rest = (await get("/api/dashboard")).body as { projects: { key: string }[] };
    expect(rest.projects.map((p) => p.key)).toEqual(["AI"]);
    expect((await call("dashboard", {})).data).toEqual(rest);
  });

  it("GivenAnUnknownProjectOrTooManyWeeks_WhenRead_ThenBothSidesRefuse", async () => {
    const { get, call } = await setup();
    expect((await get("/api/projects/zz/dashboard")).status).toBe(404);
    const missing = await call("dashboard", { project: "ZZ" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("not found");

    expect((await get("/api/dashboard?weeks=999")).status).toBe(400);
    expect((await call("dashboard", { weeks: 999 })).isError).toBe(true);
  });
});
