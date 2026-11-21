import {
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type BoardTicket,
} from "@andy/contracts";
import { boardLanes } from "@andy/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { TokenVerifier } from "./auth";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";
import { MAX_BOARD_TOOL_TICKETS } from "./mcp/tools-board";
import { ownerOnlyAccess, type ProjectAccess } from "./project-access";

const PUBLIC_URL = "https://control-plane.example.run.app";
const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

describe("MCP board matches GET …/board (AI-296)", () => {
  let tracker: InMemoryWorkTracker;
  let grants: InMemoryOAuthGrantStore;
  let app: ReturnType<typeof createApp>;

  const appWith = (projectAccess: ProjectAccess = ownerOnlyAccess()) =>
    createApp({
      projectAccess,
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker,
      runs: new InMemoryRunStore(),
      mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
    });

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    grants = new InMemoryOAuthGrantStore();
    app = appWith();
    await tracker.createProject({ name: "AI", key: "AI" });
  });

  const getBoard = async (projectId = "ai") => {
    const res = await app.request(`/api/projects/${projectId}/board`, {
      headers: { authorization: "Bearer andy" },
    });
    return { status: res.status, json: (await res.json()) as BoardTicket[] };
  };
  const tool = async (args: Record<string, unknown>) =>
    (await mcpCaller(app, grants, `${PUBLIC_URL}/mcp`))("board", args);
  const at = (id: string, to: "ready" | "done" | "in_progress") =>
    tracker.updateTicket("ai", id, { stage: { to, forced: true, reason: null } }, "andy");

  /** An epic, tickets in three lanes (one ranked first), an archived Done one, a question. */
  async function seed() {
    const epic = await tracker.createTicket("ai", { title: "Epic", type: "epic" }, "andy");
    const a = await tracker.createTicket("ai", { title: "A", parentId: epic.id }, "andy");
    const b = await tracker.createTicket("ai", { title: "B" }, "andy");
    const c = await tracker.createTicket("ai", { title: "C" }, "andy");
    const old = await tracker.createTicket("ai", { title: "Old" }, "andy");
    await at(a.id, "ready");
    await at(c.id, "ready");
    await tracker.updateTicket("ai", c.id, { fields: { rank: "0000000000" } }, "andy");
    await at(b.id, "in_progress");
    await at(old.id, "done");
    await tracker.updateTicket("ai", old.id, { fields: { archived: true } }, "andy");
    await tracker.askQuestion("ai", b.id, { text: "Which way?" }, "andy");
    return { epic, a, b, c, old };
  }

  const keysByLane = (lanes: { stage: string; tickets: { key: string }[] }[]) =>
    lanes.map((l) => [l.stage, l.tickets.map((t) => t.key)]);

  it("GivenSeededTickets_WhenBoardIsCalled_ThenTheSameLanesTicketsAndOrderAsTheRoute", async () => {
    const { epic, a, b, c } = await seed();
    const { json } = await getBoard();

    const result = await tool({ project: "AI" });

    expect(result.isError).toBe(false);
    expect(keysByLane(result.data.lanes)).toEqual(keysByLane(boardLanes(json)));
    expect(keysByLane(result.data.lanes)).toEqual([
      ["backlog", [epic.key]],
      ["ready", [c.key, a.key]],
      ["in_progress", [b.key]],
      ["ready_for_review", []],
      ["done", []],
    ]);
    const card = result.data.lanes[2].tickets[0];
    const fromRoute = json.find((t) => t.key === b.key)!;
    expect(card).toMatchObject({
      worker: fromRoute.summary.worker,
      openQuestions: 1,
      pullRequest: null,
      run: null,
    });
    expect(result.data.lanes[1].tickets[1]).toMatchObject({ key: a.key, epic: epic.key });
    expect(result.data.truncated).toBe(false);
  });

  it("GivenAStage_WhenBoardIsCalled_ThenOnlyThatLane", async () => {
    await seed();

    const result = await tool({ project: "AI", stage: "ready" });

    expect(result.data.lanes.map((l: { stage: string }) => l.stage)).toEqual(["ready"]);
  });

  it("GivenArchivedTrue_WhenBoardIsCalled_ThenArchivedTicketsAndTheCancelledLaneShow", async () => {
    const { old } = await seed();
    const { json } = await getBoard();

    const result = await tool({ project: "AI", archived: true });

    expect(keysByLane(result.data.lanes)).toEqual(
      keysByLane(boardLanes(json, { showArchived: true })),
    );
    expect(result.data.lanes.find((l: { stage: string }) => l.stage === "done").tickets).toEqual([
      expect.objectContaining({ key: old.key, archived: true }),
    ]);
  });

  it("GivenMoreTicketsThanTheCap_WhenBoardIsCalled_ThenCappedWithFullCountsAndTruncated", async () => {
    for (let i = 0; i <= MAX_BOARD_TOOL_TICKETS; i++) {
      await tracker.createTicket("ai", { title: `T${i}` }, "andy");
    }

    const result = await tool({ project: "AI" });

    expect(result.data.lanes[0].count).toBe(MAX_BOARD_TOOL_TICKETS + 1);
    expect(result.data.lanes[0].tickets).toHaveLength(MAX_BOARD_TOOL_TICKETS);
    expect(result.data.truncated).toBe(true);
  });

  it("GivenAnUnknownProject_WhenReadBothWays_ThenBothRefuse", async () => {
    expect((await getBoard("nope")).status).toBe(404);
    expect((await tool({ project: "NOPE" })).isError).toBe(true);
  });

  it("GivenAProjectTheCallerMayNotRead_WhenReadBothWays_ThenBothAnswerNotFound", async () => {
    app = appWith({ canRead: async () => false });

    const route = await getBoard();
    const result = await tool({ project: "AI" });

    expect(route.status).toBe(404);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("not found");
  });
});
