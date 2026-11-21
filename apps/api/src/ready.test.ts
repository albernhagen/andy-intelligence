import { InMemoryOAuthGrantStore, InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { parseAllowList, type TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";

/** AI-298: Parity: ranked Ready list in the web UI. REST and MCP `list_ready` return the same. */

const PUBLIC_URL = "https://control-plane.example.run.app";
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "andy") return { uid: "andy", email: "andy@example.com", emailVerified: true };
    throw new Error("bad token");
  },
};

async function setup() {
  const tracker = new InMemoryWorkTracker();
  const project = await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
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
  });
  const get = (path: string) =>
    Promise.resolve(app.request(path, { headers: { authorization: "Bearer andy" } }));
  const call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
  const ready = async (title: string, fields: Record<string, unknown>) => {
    const t = await tracker.createTicket(project.id, { type: "chore", title }, "andy");
    await tracker.updateTicket(
      project.id,
      t.id,
      { fields, stage: { to: "ready", forced: false, reason: null } },
      "system",
    );
    return t;
  };
  await ready("Small and safe", {
    size: "S",
    risk: "low",
    riskReason: "one file",
    confidence: "high",
    confidenceReason: "done before",
  });
  await ready("Big", { size: "L", risk: "high", riskReason: "auth", confidence: "low" });
  await ready("Small, unscored risk", { size: "S" });
  await tracker.createTicket(project.id, { type: "chore", title: "Not ready", size: "S" }, "andy");
  return { get, call };
}

describe("ranked Ready list parity (AI-298)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenReadyTickets_WhenReadOverRestAndMcp_ThenBothListTheSameInRankOrder", async () => {
    const { get, call } = await setup();
    const res = await get("/api/projects/ai/ready");
    expect(res.status).toBe(200);
    const rest = (await res.json()) as { total: number; tickets: { title: string }[] };
    expect(rest.total).toBe(3);
    expect(rest.tickets.map((t) => t.title)).toEqual([
      "Small and safe",
      "Big",
      "Small, unscored risk",
    ]);
    expect((await call("list_ready", { project: "AI" })).data).toEqual(rest);
  });

  it("GivenAFilter_WhenReadOverRestAndMcp_ThenBothApplyItTheSameWay", async () => {
    const { get, call } = await setup();
    const rest = await (await get("/api/projects/ai/ready?size=S&risk=low")).json();
    expect(rest).toMatchObject({ total: 1, tickets: [{ title: "Small and safe" }] });
    expect((await call("list_ready", { project: "ai", size: "S", risk: "low" })).data).toEqual(
      rest,
    );
  });

  it("GivenAnUnknownProjectOrABadFilter_WhenRead_ThenBothRefuse", async () => {
    const { get, call } = await setup();
    const missing = await get("/api/projects/zz/ready");
    expect(missing.status).toBe(404);
    const tool = await call("list_ready", { project: "ZZ" });
    expect(tool.isError).toBe(true);
    expect(tool.text).toContain("not found");

    expect((await get("/api/projects/ai/ready?size=XL")).status).toBe(400);
    expect((await call("list_ready", { project: "AI", size: "XL" })).isError).toBe(true);
  });
});
