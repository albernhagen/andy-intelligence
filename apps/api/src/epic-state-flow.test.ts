import { InMemoryOAuthGrantStore, InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { ownerOnlyAccess } from "./project-access";

/**
 * AI-404 (ADR-0164) over the real app: REST and MCP writes keep an epic's stage in step with its
 * tickets, nobody moves an epic, and the board, roadmap, `status` and `milestone_map` agree.
 */

const PUBLIC_URL = "https://control-plane.example.run.app";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

describe("an epic's state follows its tickets (AI-404)", () => {
  let app: ReturnType<typeof createApp>;
  let tracker: InMemoryWorkTracker;
  let grants: InMemoryOAuthGrantStore;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker();
    grants = new InMemoryOAuthGrantStore();
    app = createApp({
      projectAccess: ownerOnlyAccess(),
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      runs: new InMemoryRunStore(),
      mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    });
    await tracker.createProject({ name: "AI", key: "AI" });
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, json: (await res.json()) as any };
  };
  const create = async (fields: Record<string, unknown>) =>
    (await call("POST", "/api/projects/ai/tickets", fields)).json as { id: string; key: string };
  const force = (id: string, to: string) =>
    call("POST", `/api/projects/ai/tickets/${id}/stage`, { to, force: true, reason: "test" });
  const stageOf = async (id: string) => (await tracker.getTicket("ai", id))!.stage;

  it("GivenTheLastTicket_WhenItReachesDoneOverRest_ThenTheEpicIsDoneWithAHistoryEntry", async () => {
    const epic = await create({ title: "Epic", type: "epic" });
    const child = await create({ title: "Child", parentId: epic.key });
    expect(await stageOf(epic.id)).toBe("backlog");

    await force(child.id, "done");

    expect(await stageOf(epic.id)).toBe("done");
    const last = (await tracker.listEvents("ai", epic.id)).at(-1)!;
    expect(last).toMatchObject({ kind: "stage_changed", actor: "system", data: { to: "done" } });
  });

  it("GivenADoneEpic_WhenATicketIsAddedOverMcp_ThenItIsInProgress", async () => {
    const epic = await create({ title: "Epic", type: "epic" });
    await force((await create({ title: "Child", parentId: epic.key })).id, "done");
    const mcp = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);

    const added = await mcp("create_ticket", { project: "AI", title: "Late", parentId: epic.key });

    expect(added.isError).toBe(false);
    expect(await stageOf(epic.id)).toBe("in_progress");
  });

  it("GivenAnEpic_WhenMovedOverRestOrMcp_ThenRefusedSayingItsStateFollowsItsTickets", async () => {
    const epic = await create({ title: "Epic", type: "epic" });
    const mcp = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);

    const rest = await force(epic.id, "done");
    const tool = await mcp("move_ticket", { ticket: epic.key, to: "ready" });

    expect(rest.status).toBe(422);
    expect(rest.json.error).toContain("its state follows its tickets");
    expect(tool.isError).toBe(true);
    expect(tool.text).toContain("its state follows its tickets");
    expect(await stageOf(epic.id)).toBe("backlog");
  });

  it("GivenAnEpicWithTicketsInFlight_WhenRead_ThenBoardRoadmapStatusAndMilestoneMapAgree", async () => {
    const epic = await create({ title: "Epic", type: "epic" });
    await force((await create({ title: "Done", parentId: epic.key })).id, "done");
    await force((await create({ title: "Open", parentId: epic.key })).id, "in_progress");
    const mcp = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);

    const board = (await call("GET", "/api/projects/ai/board")).json;
    const roadmap = (await call("GET", "/api/projects/ai/roadmap")).json;
    const status = (await mcp("status", { ticket: epic.key })).data;
    const map = (await mcp("milestone_map", { project: "AI" })).data;

    expect(board.find((t: { key: string }) => t.key === epic.key).stage).toBe("in_progress");
    expect(roadmap.epics[0]).toMatchObject({ key: epic.key, stage: "in_progress" });
    expect(roadmap.epics[0].state).toBe("in_progress");
    expect(status.ticket.stage).toBe("in_progress");
    expect(status.epic.state).toBe("in_progress");
    expect(status.statusLine.text).toBe("In progress · follows its tickets");
    expect(map.epics[0]).toMatchObject({ key: epic.key, state: "in_progress" });
  });

  it("GivenEpicsInLanes_WhenMcpBoardAndStatusCount_ThenEpicsAreLeftOutAsOnTheWebBoard", async () => {
    const epic = await create({ title: "Epic", type: "epic" });
    await create({ title: "Child", parentId: epic.key });
    const mcp = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);

    const board = (await mcp("board", { project: "AI" })).data;
    const overview = (await mcp("status", {})).data;

    const backlog = board.lanes.find((l: { stage: string }) => l.stage === "backlog");
    expect(backlog.tickets.map((t: { title: string }) => t.title)).toEqual(["Child"]);
    expect(backlog.count).toBe(1);
    expect(overview.projects[0].ticketsByStage.backlog).toBe(1);
  });

  it("GivenNeedsCheckSetOverRest_WhenTheLastTicketIsDone_ThenItWaitsUntilAndyClosesItOverMcp", async () => {
    const epic = await create({ title: "Epic", type: "epic" });
    const patched = await call("PATCH", `/api/projects/ai/tickets/${epic.id}`, {
      needsCheck: true,
    });
    expect(patched.json.needsCheck).toBe(true);
    await force((await create({ title: "Child", parentId: epic.key })).id, "done");
    const mcp = await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`);
    expect(await stageOf(epic.id)).toBe("ready_for_review");
    expect((await mcp("milestone_map", { project: "AI" })).text).toContain(
      "waiting for your check",
    );

    const closed = await mcp("move_ticket", { ticket: epic.key, to: "done" });

    expect(closed.isError).toBe(false);
    expect(await stageOf(epic.id)).toBe("done");
  });

  it("GivenNoFlag_WhenAnEpicIsCreated_ThenNeedsCheckIsOffByDefault", async () => {
    const epic = await create({ title: "Epic", type: "epic" });
    expect((await tracker.getTicket("ai", epic.id))!.needsCheck).toBe(false);
  });
});
