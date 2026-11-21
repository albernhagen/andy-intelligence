import {
  DEFAULT_ROUTING,
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
import { ownerOnlyAccess } from "./project-access";

/** AI-282: M9: which layer set a ticket's worker, tier and route, over REST and MCP `status`. */

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
  const routing = new InMemoryRoutingConfigStore();
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    projectAccess: ownerOnlyAccess(),
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
    routing,
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
  const get = (path: string) =>
    Promise.resolve(app.request(path, { headers: { authorization: "Bearer andy" } }));
  const call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
  const fields = {
    body: "Andy can't see where a ticket's model comes from.",
    acceptanceCriteria: ["WHEN Andy opens a ticket THE SYSTEM SHALL show its layers"],
    sizeReason: "one panel",
  };
  const epic = await tracker.createTicket(
    project.id,
    { type: "epic", title: "M9: Routing", ...fields, size: "L", overrides: { tier: "strong" } },
    "system",
  );
  const story = await tracker.createTicket(
    project.id,
    { type: "feature", title: "Layers", ...fields, size: "S", parentId: epic.id },
    "system",
  );
  return { get, call, routing, project, epic, story };
}

describe("ticket routing layers (AI-282)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAnEpicTier_WhenReadOverRestAndMcp_ThenBothNameTheEpicAndTheSameRoute", async () => {
    const { get, call, project, epic, story } = await setup();
    const res = await get(`/api/projects/${project.id}/tickets/${story.id}/routing`);
    expect(res.status).toBe(200);
    const rest = (await res.json()) as Record<string, unknown>;
    expect(rest).toMatchObject({
      step: "build",
      worker: { value: "agent", layer: "project" },
      tier: { value: "strong", layer: "epic", epicKey: epic.key },
      route: { value: DEFAULT_ROUTING.tiers.strong[0], layer: "global" },
      skipped: [],
    });

    const status = await call("status", { ticket: story.key });
    expect(status.data.routing).toEqual(rest);
  });

  it("GivenAProjectConfigWithTheProviderOff_WhenRead_ThenTheSkipsCarryTheResolversReason", async () => {
    const { get, routing, project, story } = await setup();
    const sonnetOverRouter = {
      harness: "claude-code",
      provider: "openrouter",
      model: "anthropic/claude-sonnet",
    } as const;
    await routing.put(
      {
        ...structuredClone(DEFAULT_ROUTING),
        scope: "project",
        projectId: project.id,
        tiers: {
          ...DEFAULT_ROUTING.tiers,
          strong: [sonnetOverRouter, ...DEFAULT_ROUTING.tiers.strong],
        },
      },
      null,
    );
    await routing.put(
      {
        ...structuredClone(DEFAULT_ROUTING),
        tiers: {
          ...DEFAULT_ROUTING.tiers,
          strong: [sonnetOverRouter, ...DEFAULT_ROUTING.tiers.strong],
        },
      },
      null,
    );
    const res = await get(`/api/projects/${project.id}/tickets/${story.id}/routing`);
    const body = (await res.json()) as {
      route: { layer: string };
      skipped: { reason: string }[];
    };
    expect(body.route.layer).toBe("project");
    expect(body.skipped).toEqual([
      { route: sonnetOverRouter, reason: "provider openrouter is off" },
    ]);
  });
});
