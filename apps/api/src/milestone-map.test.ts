import {
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type Stage,
} from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { hashToken, newToken } from "./mcp/tokens";
import { ownerOnlyAccess } from "./project-access";

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

describe("milestone map API and MCP (AI-148)", () => {
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
      projectAccess: ownerOnlyAccess(),
      mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    });
    await tracker.createProject({ name: "AI", key: "AI" });
  });

  const get = async (path: string, token = "andy") => {
    const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, json: (await res.json()) as any };
  };

  const mcpMap = async (args: Record<string, unknown>) => {
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
    const result = await client.callTool({ name: "milestone_map", arguments: args });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return result as any;
  };

  const at = (projectId: string, id: string, to: Stage) =>
    tracker.updateTicket(projectId, id, { stage: { to, forced: true, reason: null } }, "andy");

  /** An epic with a Done child, one in review with PR #42, and one blocked by it. */
  async function seed() {
    const epic = await tracker.createTicket("ai", { title: "M4: Epics", type: "epic" }, "andy");
    const child = (title: string, blockedBy: string[] = []) =>
      tracker.createTicket("ai", { title, parentId: epic.id, blockedBy }, "andy");
    const done = await child("Done one");
    const review = await child("In review");
    const blocked = await child("Blocked", [review.key]);
    await at("ai", done.id, "done");
    await at("ai", review.id, "ready_for_review");
    await tracker.linkPullRequest(
      "ai",
      review.id,
      { number: 42, url: "https://github.com/o/r/pull/42", state: "open" },
      "system",
    );
    return { epic, done, review, blocked };
  }

  it("GivenAnEpic_WhenTheMapIsRead_ThenChildrenAreGroupedWithThePrAndBlocker", async () => {
    const { epic, done, review, blocked } = await seed();

    const { status, json } = await get("/api/projects/ai/milestone-map");

    expect(status).toBe(200);
    expect(json.epics).toHaveLength(1);
    expect(json.epics[0]).toMatchObject({
      key: epic.key,
      progress: { done: 1, total: 3 },
      done: [done.key],
      inReview: [{ key: review.key, prNumber: 42 }],
      blocked: [{ key: blocked.key, openBlockers: [review.key] }],
    });
    expect(json.text).toContain(`In review: ${review.key} (PR #42)`);
  });

  it("GivenAnEpicKey_WhenRead_ThenOnlyThatEpic", async () => {
    const { epic } = await seed();
    await tracker.createTicket("ai", { title: "Other", type: "epic" }, "andy");

    const { json } = await get(`/api/projects/ai/milestone-map?epic=${epic.key}`);

    expect(json.epics.map((e: { key: string }) => e.key)).toEqual([epic.key]);
  });

  it("GivenAKeyThatIsNoEpic_WhenRead_Then422", async () => {
    const { done } = await seed();
    expect((await get(`/api/projects/ai/milestone-map?epic=${done.key}`)).status).toBe(422);
  });

  it("GivenAMalformedKey_WhenRead_Then400", async () => {
    expect((await get("/api/projects/ai/milestone-map?epic=nope")).status).toBe(400);
  });

  it("GivenAnUnknownProject_WhenRead_Then404", async () => {
    expect((await get("/api/projects/nope/milestone-map")).status).toBe(404);
  });

  it("GivenNoToken_WhenRead_Then401", async () => {
    expect((await get("/api/projects/ai/milestone-map", "bad")).status).toBe(401);
  });

  it("GivenAnEpic_WhenMcpMilestoneMapIsCalled_ThenTextFirstAndTheSameStructure", async () => {
    await seed();
    const { json } = await get("/api/projects/ai/milestone-map");

    const result = await mcpMap({ project: "ai" });

    expect(result.content[0]).toEqual({ type: "text", text: json.text });
    expect(result.structuredContent).toEqual(json);
  });

  it("GivenAnUnknownProject_WhenMcpMilestoneMapIsCalled_ThenAnError", async () => {
    expect((await mcpMap({ project: "NOPE" })).isError).toBe(true);
  });
});
