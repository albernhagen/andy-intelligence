import {
  InMemoryMilestoneStore,
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type Stage,
} from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { syncEpicStages } from "@andy/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { hashToken, newToken } from "./mcp/tokens";
import { ownerOnlyAccess, type ProjectAccess } from "./project-access";

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

describe("roadmap API and MCP (AI-193)", () => {
  let tracker: InMemoryWorkTracker;
  let grants: InMemoryOAuthGrantStore;

  const appWith = (projectAccess: ProjectAccess = ownerOnlyAccess()) =>
    createApp({
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      runs: new InMemoryRunStore(),
      projectAccess,
      mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    });
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    grants = new InMemoryOAuthGrantStore();
    app = appWith();
    await tracker.createProject({ name: "AI", key: "AI" });
    await tracker.createProject({ name: "Ops", key: "OPS" });
  });

  const get = async (path: string, token = "andy") => {
    const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, json: (await res.json()) as any };
  };

  const mcpRoadmap = async (args: Record<string, unknown>) => {
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
    const result = await client.callTool({ name: "roadmap", arguments: args });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return result as any;
  };

  /**
   * M1 (Done) and M2 with an outcome, a child epic, and tickets in several stages. Written as the
   * app writes (ADR-0164), so each epic's stage follows its tickets.
   */
  async function seed() {
    const synced = syncEpicStages(tracker);
    const create = (input: Parameters<InMemoryWorkTracker["createTicket"]>[1]) =>
      synced.createTicket("ai", input, "andy");
    const at = (projectId: string, id: string, to: Stage) =>
      synced.updateTicket(projectId, id, { stage: { to, forced: true, reason: null } }, "andy");
    const m1 = await create({ title: "M1", type: "epic" });
    const m1Done = await create({ title: "M1 done", parentId: m1.id });
    const m2 = await create({
      title: "M2",
      type: "epic",
      outcome: "Self-hosting works",
      acceptanceCriteria: ["Builds itself"],
    });
    const sub = await create({ title: "M2.a", type: "epic", parentId: m2.id });
    const doneOne = await create({ title: "Done", parentId: m2.id });
    const review = await create({ title: "Review", parentId: m2.id });
    await create({ title: "Blocked", parentId: m2.id, blockedBy: [review.key] });
    const subStory = await create({ title: "Sub ticket", parentId: sub.id });
    await at("ai", doneOne.id, "done");
    await at("ai", review.id, "ready_for_review");
    await at("ai", subStory.id, "in_progress");
    await at("ai", m1Done.id, "done");
    return { m1, m2, sub };
  }

  it("GivenSeededEpics_WhenTheProjectRoadmapIsRead_ThenEpicsWithStateProgressAndCounts", async () => {
    const { m1, m2, sub } = await seed();

    const { status, json } = await get("/api/projects/ai/roadmap");

    expect(status).toBe(200);
    expect(json.epics.map((e: { key: string; state: string }) => [e.key, e.state])).toEqual([
      [m1.key, "done"],
      [m2.key, "in_progress"],
    ]);
    expect(json.epics[1]).toMatchObject({
      outcome: "Self-hosting works",
      doneWhen: ["Builds itself"],
      progress: { done: 1, total: 4 },
      counts: { inReview: 1, inProgress: 1, blocked: 1, notStarted: 0 },
      children: [{ key: sub.key, state: "in_progress", progress: { done: 0, total: 1 } }],
    });
  });

  it("GivenTwoProjects_WhenAllRoadmapsAreRead_ThenOnePerProjectByKey", async () => {
    await seed();

    const { status, json } = await get("/api/roadmap");

    expect(status).toBe(200);
    expect(json.projects.map((p: { projectKey: string }) => p.projectKey)).toEqual(["AI", "OPS"]);
    expect(json.truncated).toBe(false);
  });

  it("GivenAProjectTheCallerMayNotRead_WhenRoadmapsAreRead_ThenLeftOutOrNotFound", async () => {
    app = appWith({ canRead: async (_actor, projectId) => projectId !== "ops" });

    const all = await get("/api/roadmap");
    const one = await get("/api/projects/ops/roadmap");
    const tool = await mcpRoadmap({});
    const toolOne = await mcpRoadmap({ project: "OPS" });

    expect(all.json.projects.map((p: { projectKey: string }) => p.projectKey)).toEqual(["AI"]);
    expect(one.status).toBe(404);
    expect(
      tool.structuredContent.projects.map((p: { projectKey: string }) => p.projectKey),
    ).toEqual(["AI"]);
    expect(toolOne.isError).toBe(true);
  });

  it("GivenAnUnknownProject_WhenRead_Then404", async () => {
    expect((await get("/api/projects/nope/roadmap")).status).toBe(404);
  });

  it("GivenNoToken_WhenRead_Then401", async () => {
    expect((await get("/api/roadmap", "bad")).status).toBe(401);
  });

  it("GivenSeededEpics_WhenMcpRoadmapIsCalled_ThenTheSameDataAsTheApi", async () => {
    await seed();
    const one = await get("/api/projects/ai/roadmap");
    const all = await get("/api/roadmap");

    expect((await mcpRoadmap({ project: "ai" })).structuredContent).toEqual(one.json);
    expect((await mcpRoadmap({})).structuredContent).toEqual(all.json);
  });
});

describe("roadmap by milestone over API and MCP (AI-305)", () => {
  /** No write path sets an epic's milestone before AI-304, so the test tracker reports it. */
  const milestoneOfKey = new Map<string, string>();
  let tracker: InMemoryWorkTracker;
  let grants: InMemoryOAuthGrantStore;
  let milestones: InMemoryMilestoneStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    milestoneOfKey.clear();
    const raw = new InMemoryWorkTracker();
    tracker = new Proxy(raw, {
      get(target, prop, receiver) {
        if (prop === "listTickets") {
          return async (...args: Parameters<InMemoryWorkTracker["listTickets"]>) =>
            (await target.listTickets(...args)).map((t) => ({
              ...t,
              milestoneId: milestoneOfKey.get(t.key) ?? null,
            }));
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    grants = new InMemoryOAuthGrantStore();
    milestones = new InMemoryMilestoneStore();
    app = createApp({
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      runs: new InMemoryRunStore(),
      milestones,
      projectAccess: ownerOnlyAccess(),
      mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    });
    await tracker.createProject({ name: "AI", key: "AI" });
  });

  const get = async (path: string) => {
    const res = await app.request(path, { headers: { authorization: "Bearer andy" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, json: (await res.json()) as any };
  };
  const milestone = (id: string, order: number, status: "approved" | "parked") =>
    milestones.create({
      id,
      projectId: "ai",
      name: `M${order}`,
      outcome: `M${order} works`,
      order,
      status,
      createdAt: "2026-11-21T00:00:00.000Z",
      updatedAt: "2026-11-21T00:00:00.000Z",
    });

  /** M1 (approved, its epic Done), M2 (parked, one epic in progress), one epic with none. */
  async function seed() {
    await milestone("m2", 2, "parked");
    await milestone("m1", 1, "approved");
    const create = (title: string, parentId?: string) =>
      tracker.createTicket("ai", parentId ? { title, parentId } : { title, type: "epic" }, "andy");
    const e1 = await create("Done epic");
    const e2 = await create("Parked epic");
    const loose = await create("Loose epic");
    const t2 = await create("Ticket", e2.id);
    await tracker.updateTicket(
      "ai",
      e1.id,
      { stage: { to: "done", forced: true, reason: null } },
      "andy",
    );
    await tracker.updateTicket(
      "ai",
      t2.id,
      { stage: { to: "in_progress", forced: true, reason: null } },
      "andy",
    );
    milestoneOfKey.set(e1.key, "m1");
    milestoneOfKey.set(e2.key, "m2");
    return { e1, e2, loose };
  }

  it("GivenMilestones_WhenTheRoadmapIsRead_ThenMilestonesInOrderWithDoneAndNoMilestone", async () => {
    const { e1, e2, loose } = await seed();

    const { status, json } = await get("/api/projects/ai/roadmap");

    expect(status).toBe(200);
    expect(json.milestones).toEqual([
      expect.objectContaining({ id: "m1", status: "approved", done: true, epicKeys: [e1.key] }),
      expect.objectContaining({
        id: "m2",
        status: "parked",
        done: false,
        epicKeys: [e2.key],
        progress: { done: 0, total: 1 },
        counts: expect.objectContaining({ inProgress: 1 }),
      }),
    ]);
    expect(json.noMilestone).toEqual([loose.key]);
  });

  it("GivenMilestones_WhenMcpRoadmapIsCalled_ThenTheSameDataAsTheApi", async () => {
    await seed();
    const one = await get("/api/projects/ai/roadmap");
    const all = await get("/api/roadmap");
    const call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);

    expect((await call("roadmap", { project: "AI" })).data).toEqual(one.json);
    expect((await call("roadmap", {})).data).toEqual(all.json);
  });
});
