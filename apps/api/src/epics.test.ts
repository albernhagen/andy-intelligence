import { InMemoryOAuthGrantStore, InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";
import { MAX_EPIC_COST_READS } from "@andy/domain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { hashToken, newToken } from "./mcp/tokens";

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;
const route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

describe("epic roll-up API and MCP status (AI-85)", () => {
  let app: ReturnType<typeof createApp>;
  let tracker: InMemoryWorkTracker;
  let runs: InMemoryRunStore;
  let grants: InMemoryOAuthGrantStore;

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    runs = new InMemoryRunStore();
    grants = new InMemoryOAuthGrantStore();
    app = createApp({
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      runs,
      mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    });
    await tracker.createProject({ name: "AI", key: "AI" });
  });

  const get = async (path: string, token = "andy") => {
    const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, json: (await res.json()) as any };
  };

  const mcpStatus = async (key: string) => {
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
    const result = await client.callTool({ name: "status", arguments: { ticket: key } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return result.structuredContent as any;
  };

  const finishedRun = async (ticketId: string, costUsd: number) => {
    const run = await runs.create({ projectId: "ai", ticketId, step: "build", route, tier: null });
    await runs.update(run.id, { status: "succeeded", costUsd }, ["queued"]);
  };

  /** An epic with a Done child (cost $1.50), a child blocked by it and a Cancelled one. */
  async function seedEpic() {
    const epic = await tracker.createTicket("ai", { title: "Epic", type: "epic" }, "andy");
    const first = await tracker.createTicket(
      "ai",
      { title: "First", type: "feature", parentId: epic.id },
      "andy",
    );
    const second = await tracker.createTicket(
      "ai",
      { title: "Second", type: "feature", parentId: epic.id, blockedBy: [first.id] },
      "andy",
    );
    const dropped = await tracker.createTicket(
      "ai",
      { title: "Dropped", type: "chore", parentId: epic.id },
      "andy",
    );
    await tracker.updateTicket(
      "ai",
      first.id,
      { stage: { to: "done", forced: true, reason: null } },
      "andy",
    );
    await tracker.updateTicket(
      "ai",
      dropped.id,
      { stage: { to: "cancelled", forced: true, reason: null } },
      "andy",
    );
    // Rank `second` first: dependency order still puts it after `first`.
    await tracker.updateTicket("ai", second.id, { fields: { rank: "0" } }, "andy");
    await finishedRun(first.id, 1.5);
    return { epic, first, second };
  }

  it("GivenAnEpic_WhenItsRollUpIsRead_ThenChildrenInDependencyOrderWithProgressAndCost", async () => {
    const { epic, first } = await seedEpic();

    const { status, json } = await get(`/api/projects/ai/tickets/${epic.id}/epic`);

    expect(status).toBe(200);
    expect(json.children.map((c: { key: string }) => c.key)).toEqual(["AI-2", "AI-3", "AI-4"]);
    expect(json.children[1]).toMatchObject({ title: "Second", openBlockers: [] });
    expect(json.children[0]).toMatchObject({ id: first.id, stage: "done" });
    expect(json.progress).toEqual({ done: 1, total: 2 });
    expect(json.cost).toEqual({ estimatedCostUsd: 1.5, completedRuns: 1, unknownRuns: 0 });
    expect(json.partial).toBe(false);
  });

  it("GivenABlockerNotDone_WhenRead_ThenTheChildListsItAsAnOpenBlocker", async () => {
    const epic = await tracker.createTicket("ai", { title: "Epic", type: "epic" }, "andy");
    const blocker = await tracker.createTicket("ai", { title: "Outside" }, "andy");
    await tracker.createTicket(
      "ai",
      { title: "Child", parentId: epic.id, blockedBy: [blocker.id] },
      "andy",
    );

    const { json } = await get(`/api/projects/ai/tickets/${epic.id}/epic`);

    expect(json.children[0].openBlockers).toEqual([blocker.key]);
  });

  it("GivenMoreChildrenThanTheReadCap_WhenRead_ThenTheRollUpSaysPartial", async () => {
    const epic = await tracker.createTicket("ai", { title: "Epic", type: "epic" }, "andy");
    for (let i = 0; i <= MAX_EPIC_COST_READS; i++) {
      await tracker.createTicket("ai", { title: `Child ${i}`, parentId: epic.id }, "andy");
    }

    const { json } = await get(`/api/projects/ai/tickets/${epic.id}/epic`);

    expect(json).toMatchObject({ partial: true, costedChildren: MAX_EPIC_COST_READS });
    expect(json.children).toHaveLength(MAX_EPIC_COST_READS + 1);
  });

  it("GivenAFeature_WhenItsRollUpIsRead_Then422", async () => {
    const t = await tracker.createTicket("ai", { title: "Feature", type: "feature" }, "andy");
    expect((await get(`/api/projects/ai/tickets/${t.id}/epic`)).status).toBe(422);
  });

  it("GivenAnUnknownTicket_WhenRead_Then404", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await get(`/api/projects/ai/tickets/${id}/epic`)).status).toBe(404);
  });

  it("GivenNoToken_WhenRead_Then401", async () => {
    const { epic } = await seedEpic();
    expect((await get(`/api/projects/ai/tickets/${epic.id}/epic`, "bad")).status).toBe(401);
  });

  it("GivenAnEpicKey_WhenMcpStatusIsCalled_ThenItReturnsTheSameChildrenAndRollUp", async () => {
    const { epic } = await seedEpic();
    const { json } = await get(`/api/projects/ai/tickets/${epic.id}/epic`);

    const status = await mcpStatus(epic.key);

    expect(status.epic).toEqual(json);
  });

  it("GivenAFeatureKey_WhenMcpStatusIsCalled_ThenNoEpicRollUp", async () => {
    const t = await tracker.createTicket("ai", { title: "Feature", type: "feature" }, "andy");
    expect(await mcpStatus(t.key)).not.toHaveProperty("epic");
  });
});
