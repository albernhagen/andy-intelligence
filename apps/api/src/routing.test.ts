import {
  DEFAULT_ROUTING,
  InMemoryConfigChangeStore,
  InMemoryOAuthGrantStore,
  InMemoryRoutingConfigStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { parseAllowList, type TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";

/** AI-239: M9.7: routing settings over REST and MCP, against the in-memory stores. */

const PUBLIC_URL = "https://control-plane.example.run.app";
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "andy") return { uid: "andy", email: "andy@example.com", emailVerified: true };
    if (token === "eve") return { uid: "eve", email: "eve@example.com", emailVerified: true };
    throw new Error("bad token");
  },
};

const save = (overrides: Record<string, unknown> = {}) => ({
  providers: structuredClone(DEFAULT_ROUTING.providers),
  tiers: structuredClone(DEFAULT_ROUTING.tiers),
  steps: structuredClone(DEFAULT_ROUTING.steps),
  ifUpdatedAt: null,
  ...overrides,
});

async function setup() {
  const tracker = new InMemoryWorkTracker();
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  const changes = new InMemoryConfigChangeStore();
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    configChanges: changes,
    routing: new InMemoryRoutingConfigStore(),
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  const request = (method: string, path: string, body?: unknown, token = "andy") =>
    Promise.resolve(
      app.request(path, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  const call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
  return { request, call, changes };
}

describe("routing settings (AI-239)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenNothingSaved_WhenRead_ThenGlobalDefaultsAndTheProjectFollowsThem", async () => {
    const { request } = await setup();
    const res = await request("GET", "/api/routing");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      global: { tiers: unknown };
      projects: { projectId: string; config: unknown }[];
    };
    expect(body.global.tiers).toEqual(DEFAULT_ROUTING.tiers);
    expect(body.projects).toMatchObject([{ projectId: "ai", config: null }]);
  });

  it("GivenJulesOnClaudeSub_WhenSavedOverRestAndMcp_ThenBothRefuseWithTheReason", async () => {
    const { request, call } = await setup();
    const bad = { harness: "jules", provider: "claude-sub", model: "jules" };
    const tiers = { ...DEFAULT_ROUTING.tiers, fast: [bad] };
    const res = await request("PUT", "/api/routing", save({ tiers }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { details: string[] };
    expect(body.details[0]).toContain("harness jules doesn't run on provider claude-sub");

    const tool = await call("set_tier_routes", { tier: "fast", routes: [bad] });
    expect(tool.isError).toBe(true);
    expect(tool.text).toContain("harness jules doesn't run on provider claude-sub");
  });

  it("GivenAProjectEnablingAProviderGlobalDisables_WhenSaved_ThenRefused", async () => {
    const { request } = await setup();
    const providers = structuredClone(DEFAULT_ROUTING.providers);
    providers["google-sub"].enabled = true;
    const res = await request("PUT", "/api/projects/ai/routing", save({ providers }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { details: string[] }).details).toContain(
      "provider google-sub is off globally",
    );
  });

  it("GivenAnAcceptedSave_WhenSaved_ThenOneConfigChangeNamesWhoAndWhat", async () => {
    const { request, changes } = await setup();
    const steps = { ...DEFAULT_ROUTING.steps, refine: "cheap" };
    const res = await request(
      "PUT",
      "/api/projects/ai/routing",
      save({ steps, reason: "cheaper" }),
    );
    expect(res.status).toBe(200);
    const log = await changes.listForProject("ai");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      entity: "routing",
      entityId: "ai",
      actor: "andy",
      reason: "cheaper",
    });
    expect(Object.keys(log[0]!.diff)).toEqual(["providers", "tiers", "steps"]);
  });

  it("GivenAStaleRead_WhenSaved_ThenConflict", async () => {
    const { request } = await setup();
    const steps = { ...DEFAULT_ROUTING.steps, refine: "cheap" };
    expect((await request("PUT", "/api/routing", save({ steps }))).status).toBe(200);
    expect((await request("PUT", "/api/routing", save())).status).toBe(409);
  });

  it("GivenSomeoneWhoIsntTheOwner_WhenTheyCallAWriteRoute_ThenForbidden", async () => {
    const { request } = await setup();
    expect((await request("PUT", "/api/routing", save(), "eve")).status).toBe(403);
    expect((await request("PUT", "/api/projects/ai/routing", save(), "eve")).status).toBe(403);
  });

  it("GivenGetRoutingOverMcp_WhenCalled_ThenItListsTheTiersAndTheirRoutes", async () => {
    const { call } = await setup();
    const result = await call("get_routing", { project: "ai" });
    expect(result.isError).toBe(false);
    expect(result.data.global.tiers.fast).toEqual([
      { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
    ]);
    expect(result.data.global.tiers.frontier[0].model).toBe("opus");
    expect(result.data.project).toMatchObject({ key: "AI", config: null });
  });

  it("GivenSetTierRoutesOverMcp_WhenValid_ThenSavedAndLogged", async () => {
    const { call, changes } = await setup();
    const result = await call("set_tier_routes", {
      project: "ai",
      tier: "cheap",
      routes: [{ harness: "claude-code", provider: "claude-sub", model: "sonnet" }],
      reason: "pin cheap",
    });
    expect(result.isError).toBe(false);
    expect(result.data.scope).toBe("project");
    expect((await changes.listForProject("ai"))[0]).toMatchObject({ entity: "routing" });
  });

  it("GivenOneProjectAsked_WhenRead_ThenOnlyThatProject", async () => {
    const { request } = await setup();
    const res = await request("GET", "/api/routing?projectId=ai");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: { projectId: string }[]; truncated: boolean };
    expect(body.projects.map((p) => p.projectId)).toEqual(["ai"]);
    expect(body.truncated).toBe(false);
    expect((await request("GET", "/api/routing?projectId=ops")).status).toBe(404);
  });

  it("GivenProviderAndStepEditsOverMcp_WhenCalled_ThenSavedOrRefusedWithTheReason", async () => {
    const { call } = await setup();
    const off = { ...DEFAULT_ROUTING.providers["google-sub"], enabled: true };
    const refused = await call("set_provider_routing", {
      project: "ai",
      provider: "google-sub",
      settings: off,
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("provider google-sub is off globally");
    const step = await call("set_step_tier", { step: "review", tier: "cheap" });
    expect(step.isError).toBe(false);
    expect(step.data.steps.review).toBe("cheap");
  });

  it("GivenAProjectsFirstRoutingSave_WhenRevertedFromItsSettingsLog_ThenA409SayingWhy", async () => {
    const { request, changes } = await setup();
    const steps = { ...DEFAULT_ROUTING.steps, refine: "cheap" };
    await request("PUT", "/api/projects/ai/routing", save({ steps }));
    const [change] = await changes.listForProject("ai");
    const res = await request("POST", `/api/projects/ai/config-changes/${change!.id}/revert`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("first save");
  });

  it("GivenAProjectsLaterRoutingSave_WhenRevertedFromItsSettingsLog_ThenTheRoutingIsBack", async () => {
    const { request, changes } = await setup();
    const first = await request(
      "PUT",
      "/api/projects/ai/routing",
      save({ steps: { ...DEFAULT_ROUTING.steps, refine: "cheap" } }),
    );
    const { updatedAt } = (await first.json()) as { updatedAt: string };
    await request(
      "PUT",
      "/api/projects/ai/routing",
      save({ steps: { ...DEFAULT_ROUTING.steps, refine: "strong" }, ifUpdatedAt: updatedAt }),
    );
    const [latest] = await changes.listForProject("ai");
    const res = await request("POST", `/api/projects/ai/config-changes/${latest!.id}/revert`);
    expect(res.status).toBe(200);
    const view = (await (await request("GET", "/api/routing?projectId=ai")).json()) as {
      projects: { config: { steps: { refine: string } } }[];
    };
    expect(view.projects[0]!.config.steps.refine).toBe("cheap");
  });

  it("GivenGlobalSaves_WhenListedAndRevertedOverRest_ThenTheLogShowsBothAndTheRoutingIsBack", async () => {
    const { request } = await setup();
    await request(
      "PUT",
      "/api/routing",
      save({ steps: { ...DEFAULT_ROUTING.steps, refine: "cheap" } }),
    );
    const listed = await request("GET", "/api/routing/changes");
    expect(listed.status).toBe(200);
    const [change] = (await listed.json()) as { id: string; entityId: string }[];
    expect(change!.entityId).toBe("global");
    const res = await request("POST", `/api/routing/changes/${change!.id}/revert`);
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { config: { steps: { refine: string } } }).config.steps.refine,
    ).toBe("fast");
    const after = (await (await request("GET", "/api/routing/changes")).json()) as unknown[];
    expect(after).toHaveLength(2);
    expect((await request("POST", `/api/routing/changes/${change!.id}/revert`)).status).toBe(409);
  });

  it("GivenGlobalChangesOverMcp_WhenListedAndReverted_ThenBothToolsWork", async () => {
    const { call } = await setup();
    await call("set_step_tier", { step: "review", tier: "cheap" });
    const listed = await call("list_routing_changes");
    expect(listed.isError).toBe(false);
    const id = listed.data.changes[0].id as string;
    const reverted = await call("revert_routing_change", { id });
    expect(reverted.isError).toBe(false);
    expect(reverted.data.config.steps.review).toBe("fast");
    expect(reverted.data.reverted.status).toBe("reverted");
  });
});
