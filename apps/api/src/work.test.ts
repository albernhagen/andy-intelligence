import { InMemoryOAuthGrantStore, InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { parseAllowList, type TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";

const PUBLIC_URL = "https://control-plane.example.run.app";
const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

type Body = {
  view: string;
  counts: Record<string, number>;
  truncated: boolean;
  projects: { key: string; count: number; tickets: { key: string; blockers: string[] }[] }[];
};

describe("work across projects (AI-198)", () => {
  let app: ReturnType<typeof createApp>;
  let tracker: InMemoryWorkTracker;
  let call: Awaited<ReturnType<typeof mcpCaller>>;

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    const grants = new InMemoryOAuthGrantStore();
    app = createApp({
      projectAccess: ownerOnlyAccess(),
      verifier,
      allowedEmails: parseAllowList("andy@example.com"),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      runs: new InMemoryRunStore(),
      mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    });
    call = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
    await tracker.createProject({ name: "Ops", key: "OPS" });
    await tracker.createProject({ name: "AI", key: "AI" });
    const asked = await tracker.createTicket("ai", { title: "Asked" }, "andy");
    await tracker.askQuestion("ai", asked.id, { text: "Which?" }, "andy");
    await tracker.createTicket("ai", { title: "Waits", blockedBy: [asked.key] }, "andy");
    const flagged = await tracker.createTicket("ops", { title: "Flagged" }, "andy");
    await tracker.updateTicket("ops", flagged.id, { fields: { needsAttention: true } }, "system");
    const done = await tracker.createTicket("ops", { title: "Done" }, "andy");
    await tracker.updateTicket(
      "ops",
      done.id,
      { stage: { to: "done", forced: true, reason: null }, fields: { needsAttention: true } },
      "andy",
    );
  });

  const get = async (path: string) => {
    const res = await app.request(path, { headers: { authorization: "Bearer andy" } });
    return { status: res.status, body: (await res.json()) as Body };
  };

  it("GivenTwoProjects_WhenNeedsMeIsRead_ThenOpenTicketsAreGroupedByProjectKey", async () => {
    const { status, body } = await get("/api/work?view=needs-me");

    expect(status).toBe(200);
    expect(body.projects.map((p) => [p.key, p.tickets.map((t) => t.key)])).toEqual([
      ["AI", ["AI-1"]],
      ["OPS", ["OPS-1"]],
    ]);
    expect(body.counts["needs-me"]).toBe(2);
    expect(body.truncated).toBe(false);
  });

  it("GivenAProjectFilter_WhenBlockedIsRead_ThenOnlyThatProjectsBlockedTicketsComeBack", async () => {
    const { body } = await get("/api/work?view=blocked&project=ai");

    expect(body.projects).toEqual([
      expect.objectContaining({
        key: "AI",
        count: 1,
        tickets: [expect.objectContaining({ key: "AI-2", blockers: ["AI-1"] })],
      }),
    ]);
  });

  it.each(["/api/work", "/api/work?view=everything", "/api/work?view=mine&project=AI!"])(
    "GivenTheBadQuery %s_WhenRead_Then400",
    async (path) => {
      expect((await get(path)).status).toBe(400);
    },
  );

  it("GivenAnUnknownProject_WhenRead_Then404", async () => {
    expect((await get("/api/work?view=mine&project=nope")).status).toBe(404);
  });

  it("GivenAView_WhenListWorkIsCalled_ThenItReturnsTheTicketsTheRouteReturns", async () => {
    const { body } = await get("/api/work?view=needs-me");

    const result = await call("list_work", { view: "needs-me" });

    expect(result.isError).toBe(false);
    expect(
      result.data.projects.map((p: { key: string; tickets: { key: string }[] }) => [
        p.key,
        p.tickets.map((t) => t.key),
      ]),
    ).toEqual(body.projects.map((p) => [p.key, p.tickets.map((t) => t.key)]));
    expect(result.data.counts).toEqual(body.counts);
  });

  it("GivenAProjectKey_WhenListWorkIsCalled_ThenOnlyThatProjectIsListed", async () => {
    const result = await call("list_work", { view: "blocked", project: "ai" });

    expect(result.data.projects).toEqual([
      expect.objectContaining({
        key: "AI",
        tickets: [expect.objectContaining({ key: "AI-2", blockers: ["AI-1"] })],
      }),
    ]);
  });
});
