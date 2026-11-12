import {
  InMemoryOAuthGrantStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type NewTicket,
  type Ticket,
} from "@andy/contracts";
import { TicketService, inboxCards, ticketStatusLine } from "@andy/domain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ClientMetadataResolver } from "./client-metadata";
import type { ToolDeps } from "./tools";
import { registerTicketTools } from "./tools-tickets";
import { hashToken, newToken } from "./tokens";

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

const story = (title: string): NewTicket => ({
  type: "feature",
  title,
  body: "Andy can't see tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  size: "S",
  sizeReason: "one screen",
});

async function setup() {
  const tracker = new InMemoryWorkTracker();
  const runs = new InMemoryRunStore();
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs,
    mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
  });
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
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { isError: result.isError === true, text, data: result.structuredContent as any };
  };
  const rest = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { authorization: "Bearer andy", "content-type": "application/json" },
    });
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await tracker.createProject({ name: "Ops", key: "OPS" });
  return { tracker, service: new TicketService(tracker), call, rest };
}

describe("the inbox from any harness (real path)", () => {
  it("GivenOpenQuestions_WhenListedAndAnswered_ThenOrderAndStatusLineMatchTheDomainFunctions", async () => {
    const ctx = await setup();
    // AI-1 still needs refining; AI-2 is blocked only by its question, so answering readies it.
    const vague = await ctx.service.create("ai", { title: "Vague" }, "andy");
    const near = await ctx.service.create("ai", story("Near ready"), "andy");
    await ctx.service.ask("ai", vague.id, { text: "What is it?" }, "agent:r1");
    const q2 = await ctx.service.ask(
      "ai",
      near.id,
      { text: "Which board?", options: ["Kanban"], suggestedAnswer: "Kanban" },
      "agent:r1",
    );

    const listed = await ctx.call("list_needs_me");
    const expected = inboxCards(await ctx.service.needsYou());
    const keys = [...expected.active, ...expected.stale].map((c) => c.ticket?.key);
    expect(keys).toEqual(["AI-2", "AI-1"]);
    expect(listed.data.cards.map((c: { ticket: Ticket }) => c.ticket.key)).toEqual(keys);
    expect(listed.data.questions.map((q: { ticket: string }) => q.ticket)).toEqual(keys);
    expect(listed.data.cards[0]).toMatchObject({
      stale: false,
      statusLine: { text: "Waiting for you: 1 question", tone: "attention" },
      questions: [{ id: q2.id, options: ["Kanban"], suggestedAnswer: "Kanban" }],
      plan: null,
    });

    const needsYou = (await (await ctx.rest("/api/needs-you")).json()) as {
      questions: { ticketId: string }[];
    };
    expect(needsYou.questions.map((q) => q.ticketId)).toEqual([near.id, vague.id]);

    const answered = await ctx.call("answer_question", { questionId: q2.id, answer: "Kanban" });
    expect(answered.data.ticket).toMatchObject({ key: "AI-2", dorStatus: "met" });

    const status = await ctx.call("status", { ticket: "AI-2" });
    const ticket = (await ctx.tracker.getTicket("ai", near.id))!;
    const line = ticketStatusLine(
      ticket,
      {
        tickets: await ctx.tracker.listTickets("ai"),
        runs: [],
        events: await ctx.tracker.listEvents("ai", near.id),
        openQuestions: 0,
      },
      new Date(),
    );
    expect(status.data.statusLine).toEqual(line);
    expect(status.data).toHaveProperty("cost");
  });
});

describe("edit_ticket", () => {
  it("GivenFields_WhenEdited_ThenOnlyThoseChangeAndDorIsRechecked", async () => {
    const ctx = await setup();
    const t = await ctx.service.create("ai", { title: "Old" }, "andy");
    const res = await ctx.call("edit_ticket", {
      ticket: t.key,
      ...story("New"),
    });
    expect(res.isError).toBe(false);
    expect(res.data.ticket).toMatchObject({ title: "New", dorStatus: "met" });
    expect((await ctx.tracker.getTicket("ai", t.id))?.size).toBe("S");
  });

  it("GivenBlockerKeysInAnyProject_WhenEdited_ThenStoredAsKeysAndUnknownOnesNotFound", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    const b = await ctx.service.create("ai", { title: "B" }, "andy");
    const ops = await ctx.service.create("ops", { title: "O" }, "andy");
    await ctx.call("edit_ticket", { ticket: a.key, blockedBy: [b.key, ops.key] });
    expect((await ctx.tracker.getTicket("ai", a.id))?.blockedBy).toEqual(["AI-2", "OPS-1"]);

    for (const key of ["OPS-9", "NOPE-1"]) {
      const res = await ctx.call("edit_ticket", { ticket: a.key, blockedBy: [key] });
      expect(res).toMatchObject({ isError: true });
      expect(res.text).toMatch(/not found/);
    }
    const patched = await ctx.rest(`/api/projects/ai/tickets/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ blockedBy: ["OPS-9"] }),
    });
    expect(patched.status).toBe(404);
    expect((await ctx.tracker.getTicket("ai", a.id))?.blockedBy).toEqual(["AI-2", "OPS-1"]);
  });

  it("GivenACrossProjectCycle_WhenEdited_ThenRefused", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    const ops = await ctx.service.create("ops", { title: "O" }, "andy");
    await ctx.call("edit_ticket", { ticket: ops.key, blockedBy: [a.key] });
    const res = await ctx.call("edit_ticket", { ticket: a.key, blockedBy: [ops.key] });
    expect(res).toMatchObject({ isError: true, text: "OPS-1 is already waiting on AI-1" });
  });

  it("GivenABlockerCycle_WhenEdited_ThenRefusedOverMcpAndRest", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    const b = await ctx.service.create("ai", { title: "B" }, "andy");
    await ctx.call("edit_ticket", { ticket: a.key, blockedBy: [b.key] });

    const res = await ctx.call("edit_ticket", { ticket: b.key, blockedBy: [a.key] });
    expect(res).toMatchObject({ isError: true, text: "AI-1 is already waiting on AI-2" });
    const patched = await ctx.rest(`/api/projects/ai/tickets/${b.id}`, {
      method: "PATCH",
      body: JSON.stringify({ blockedBy: [a.id] }),
    });
    expect(patched.status).toBe(422);
    expect((await ctx.tracker.getTicket("ai", b.id))?.blockedBy).toEqual([]);
  });

  it("GivenNoFieldsOrAStaleTimestamp_WhenEdited_ThenRefused", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    expect((await ctx.call("edit_ticket", { ticket: a.key })).isError).toBe(true);
    const stale = await ctx.call("edit_ticket", {
      ticket: a.key,
      title: "B",
      ifUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    expect(stale.isError).toBe(true);
    expect((await ctx.tracker.getTicket("ai", a.id))?.title).toBe("A");
  });
});

describe("comment_ticket", () => {
  it("GivenABody_WhenCommented_ThenItIsInHistoryAsTheSignedInUser", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    const res = await ctx.call("comment_ticket", { ticket: a.key, body: "Looks right" });
    expect(res.data.comment).toMatchObject({
      kind: "comment",
      actor: "user:andy",
      body: "Looks right",
    });
  });

  it("GivenAnUnknownProject_WhenCommented_ThenRefused", async () => {
    const ctx = await setup();
    expect((await ctx.call("comment_ticket", { ticket: "NOPE-1", body: "x" })).isError).toBe(true);
  });
});

describe("set_ticket_parent", () => {
  it("GivenAnEpic_WhenReparentedAndCleared_ThenTheParentFollows", async () => {
    const ctx = await setup();
    const epic = await ctx.service.create("ai", { title: "E", type: "epic" }, "andy");
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    await ctx.call("set_ticket_parent", { ticket: a.key, parent: epic.key });
    expect((await ctx.tracker.getTicket("ai", a.id))?.parentId).toBe(epic.id);
    await ctx.call("set_ticket_parent", { ticket: a.key, parent: null });
    expect((await ctx.tracker.getTicket("ai", a.id))?.parentId).toBeNull();
  });

  it("GivenAnEpicInAnotherProject_WhenReparented_ThenRefusedOverMcpAndRest", async () => {
    const ctx = await setup();
    const epic = await ctx.service.create("ops", { title: "E", type: "epic" }, "andy");
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    const res = await ctx.call("set_ticket_parent", { ticket: a.key, parent: epic.key });
    expect(res).toMatchObject({ isError: true, text: "OPS-1 is not in this project" });

    const patched = await ctx.rest(`/api/projects/ai/tickets/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ parentId: epic.id }),
    });
    expect(patched.status).toBe(422);
    expect((await ctx.tracker.getTicket("ai", a.id))?.parentId).toBeNull();
  });
});

describe("create_ticket parent (AI-130)", () => {
  it("GivenAnEpicKey_WhenCreatedOverMcp_ThenTheEpicsIdIsStored", async () => {
    const ctx = await setup();
    const epic = await ctx.service.create("ai", { title: "E", type: "epic" }, "andy");
    const res = await ctx.call("create_ticket", { project: "AI", title: "A", parentId: epic.key });
    expect(res.isError).toBe(false);
    const created = (await ctx.tracker.listTickets("ai")).find((t) => t.title === "A");
    expect(created?.parentId).toBe(epic.id);
  });

  it("GivenAMissingOrNonEpicParent_WhenCreatedOverMcpOrRest_ThenRefusedAndNothingCreated", async () => {
    const ctx = await setup();
    const story = await ctx.service.create("ai", { title: "S", type: "feature" }, "andy");
    const missing = await ctx.call("create_ticket", {
      project: "AI",
      title: "A",
      parentId: "AI-9",
    });
    expect(missing).toMatchObject({ isError: true, text: "AI-9 is not in this project" });
    const notEpic = await ctx.rest("/api/projects/ai/tickets", {
      method: "POST",
      body: JSON.stringify({ title: "A", parentId: story.id }),
    });
    expect(notEpic.status).toBe(422);
    expect((await ctx.tracker.listTickets("ai")).map((t) => t.key)).toEqual([story.key]);
  });

  it("GivenAnEpicId_WhenCreatedOverRest_ThenThatIdIsStored", async () => {
    const ctx = await setup();
    const epic = await ctx.service.create("ai", { title: "E", type: "epic" }, "andy");
    const res = await ctx.rest("/api/projects/ai/tickets", {
      method: "POST",
      body: JSON.stringify({ title: "A", parentId: epic.id }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { parentId: string }).parentId).toBe(epic.id);
  });
});

describe("accept_assumption", () => {
  const held = {
    id: "r1-a1",
    text: "Assume kanban",
    question: "Kanban?",
    options: [],
    cost: "direction",
    confidence: "unsure",
    demotedBy: "daily_cap",
    runId: "r1",
    status: "assumed",
    questionId: null,
    answeredAt: null,
    settledBy: null,
    createdAt: "2026-11-08T00:00:00.000Z",
  };

  /** The ticket tools wired to `actor` directly: the HTTP endpoint only ever passes a user. */
  async function callAs(actor: string, tracker: InMemoryWorkTracker, service: TicketService) {
    const server = new McpServer({ name: "test", version: "1" });
    registerTicketTools(server, { tracker, service, actor, email: "" } as unknown as ToolDeps);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    return async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
      return { isError: result.isError === true, text };
    };
  }

  it("GivenAHeldGapAndACallerWhoIsNotTheOwner_WhenAccepted_ThenRefusedAndUnchanged", async () => {
    const ctx = await setup();
    const t = await ctx.service.create("ai", { title: "Board" }, "andy");
    await ctx.tracker.updateTicket(
      "ai",
      t.id,
      { fields: { refineAssumptions: [held] as never } },
      "system",
    );

    const call = await callAs("agent:r1", ctx.tracker, ctx.service);
    const res = await call("accept_assumption", { ticket: t.key, assumptionId: "r1-a1" });
    expect(res).toMatchObject({ isError: true, text: "only the owner can accept a held gap" });
    expect((await ctx.tracker.getTicket("ai", t.id))?.refineAssumptions[0]).toMatchObject({
      status: "assumed",
    });
  });

  it("GivenAnUnknownAssumption_WhenAcceptedByTheOwner_ThenRefused", async () => {
    const ctx = await setup();
    const t = await ctx.service.create("ai", { title: "Board" }, "andy");
    const res = await ctx.call("accept_assumption", { ticket: t.key, assumptionId: "nope" });
    expect(res.isError).toBe(true);
  });
});

describe("reorder_ticket", () => {
  it("GivenALane_WhenReordered_ThenTheBoardOrderChanges", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    const b = await ctx.service.create("ai", { title: "B" }, "andy");
    const c = await ctx.service.create("ai", { title: "C" }, "andy");
    expect((await ctx.call("reorder_ticket", { ticket: c.key, above: a.key })).isError).toBe(false);
    const order = (await ctx.tracker.listTickets("ai")).map((t) => t.key);
    expect(order).toEqual([c.key, a.key, b.key]);
  });

  it("GivenUpNext_WhenReordered_ThenItsOwnOrderChangesAndRankStays", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", { title: "A" }, "andy", { upNext: true });
    const b = await ctx.service.create("ai", { title: "B" }, "andy", { upNext: true });
    await ctx.call("reorder_ticket", { ticket: b.key, above: a.key });
    const [movedA, movedB] = await Promise.all([
      ctx.tracker.getTicket("ai", a.id),
      ctx.tracker.getTicket("ai", b.id),
    ]);
    expect(movedB!.upNextRank! < movedA!.upNextRank!).toBe(true);
    expect(movedB!.rank).toBe(b.rank);
  });

  it("GivenABadAnchor_WhenReordered_ThenRefused", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    const b = await ctx.service.create("ai", { title: "B" }, "andy");
    const ops = await ctx.service.create("ops", { title: "O" }, "andy");
    const foreign = await ctx.call("reorder_ticket", { ticket: a.key, above: ops.key });
    expect(foreign).toMatchObject({ isError: true, text: "OPS-1 is not in this project" });
    expect((await ctx.call("reorder_ticket", { ticket: a.key })).isError).toBe(true);
    const both = await ctx.call("reorder_ticket", { ticket: a.key, above: b.key, below: b.key });
    expect(both.isError).toBe(true);
  });
});

describe("reads (ADR-0028)", () => {
  it("GivenATicketKey_WhenAToolLooksItUp_ThenOnlyThatTicketIsReadNotTheProject", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    const listed = vi.spyOn(ctx.tracker, "listTickets");
    const byKey = vi.spyOn(ctx.tracker, "getTicketByKey");

    expect((await ctx.call("comment_ticket", { ticket: a.key, body: "hi" })).isError).toBe(false);
    expect(byKey).toHaveBeenCalledWith("ai", a.key);
    expect(listed).not.toHaveBeenCalled();
  });

  it("GivenTicketsInSeveralStages_WhenStatusHasNoKey_ThenCountsComeFromCountByStage", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", story("A"), "andy");
    await ctx.service.create("ai", { title: "B" }, "andy");
    await ctx.service.move("ai", a.id, "ready", "andy");
    const counted = vi.spyOn(ctx.tracker, "countByStage");
    const listed = vi.spyOn(ctx.tracker, "listTickets");

    const res = await ctx.call("status");
    const ai = res.data.projects.find((p: { key: string }) => p.key === "AI");
    expect(ai.ticketsByStage).toMatchObject({ backlog: 1, ready: 1, done: 0 });
    expect(counted).toHaveBeenCalledWith("ai");
    expect(counted).toHaveBeenCalledWith("ops");
    // Only the Needs-you inbox reads tickets, and only its filtered sets.
    for (const [, filter] of listed.mock.calls) expect(filter).toBeDefined();
  });
});
