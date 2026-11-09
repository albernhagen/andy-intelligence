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
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ClientMetadataResolver } from "./client-metadata";
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

  it("GivenBlockerKeys_WhenEdited_ThenStoredAsIdsAndForeignOnesRefused", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    const b = await ctx.service.create("ai", { title: "B" }, "andy");
    const ops = await ctx.service.create("ops", { title: "O" }, "andy");
    await ctx.call("edit_ticket", { ticket: a.key, blockedBy: [b.key] });
    expect((await ctx.tracker.getTicket("ai", a.id))?.blockedBy).toEqual([b.id]);

    const res = await ctx.call("edit_ticket", { ticket: a.key, blockedBy: [ops.key] });
    expect(res).toMatchObject({ isError: true, text: "OPS-1 is not in this project" });
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
  it("GivenABody_WhenCommented_ThenItIsInHistoryAsAndy", async () => {
    const ctx = await setup();
    const a = await ctx.service.create("ai", { title: "A" }, "andy");
    const res = await ctx.call("comment_ticket", { ticket: a.key, body: "Looks right" });
    expect(res.data.comment).toMatchObject({ kind: "comment", actor: "andy", body: "Looks right" });
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
