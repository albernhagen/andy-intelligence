import {
  InMemoryWorkTracker,
  type Question,
  type Ticket,
  type TicketEvent,
  InMemoryRunStore,
} from "@andy/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, createApp } from "./app";
import type { TokenVerifier } from "./auth";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

const readyFields = {
  body: "Andy can't see tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  size: "S",
  sizeReason: "one screen",
};

describe("ticket API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp({
      verifier,
      allowedEmails: new Set(["andy@example.com"]),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker: new InMemoryWorkTracker(),
      runs: new InMemoryRunStore(),
    });
  });

  const call = async (method: string, path: string, body?: unknown, token = "andy") => {
    const res = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> & unknown[] };
  };

  async function projectWithTicket(fields: Record<string, unknown> = {}) {
    await call("POST", "/api/projects", { name: "AI", key: "AI" });
    const { json } = await call("POST", "/api/projects/ai/tickets", {
      type: "feature",
      title: "Board",
      ...fields,
    });
    return json as unknown as Ticket;
  }

  it("GivenATicketKey_WhenReadByKey_ThenTheTicketIsReturned", async () => {
    const ticket = await projectWithTicket();
    const { status, json } = await call("GET", `/api/tickets/${ticket.key}`);
    expect(status).toBe(200);
    expect(json).toMatchObject({ id: ticket.id, key: "AI-1" });
  });

  it("GivenAnUnknownOrMalformedKey_WhenReadByKey_Then404Or400", async () => {
    await projectWithTicket();
    expect((await call("GET", "/api/tickets/AI-99")).status).toBe(404);
    expect((await call("GET", "/api/tickets/ZZ-1")).status).toBe(404);
    expect((await call("GET", "/api/tickets/ai-1")).status).toBe(400);
    expect((await call("GET", "/api/tickets/AI-1", undefined, "nope")).status).toBe(401);
  });

  it("GivenNoToken_WhenCallingTicketRoutes_ThenUnauthenticated", async () => {
    expect((await call("GET", "/api/projects", undefined, "nope")).status).toBe(401);
    expect((await call("GET", "/api/needs-you", undefined, "nope")).status).toBe(401);
  });

  it("GivenANewProject_WhenCreatedTwice_ThenCreatedThenConflict", async () => {
    const first = await call("POST", "/api/projects", { name: "AI", key: "AI" });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ id: "ai", key: "AI", autonomy: "gated" });
    expect((await call("POST", "/api/projects", { name: "AI", key: "AI" })).status).toBe(409);
    expect((await call("GET", "/api/projects")).json).toHaveLength(1);
    expect((await call("GET", "/api/projects/ai")).status).toBe(200);
    expect((await call("GET", "/api/projects/zz")).status).toBe(404);
  });

  it("GivenAProject_WhenAutoRefineIsPatched_ThenItIsStoredAndUnknownProjectsAre404", async () => {
    await call("POST", "/api/projects", { name: "AI", key: "AI" });
    expect((await call("GET", "/api/projects/ai")).json).toMatchObject({ autoRefine: true });
    const patched = await call("PATCH", "/api/projects/ai", { autoRefine: false });
    expect(patched).toMatchObject({ status: 200, json: { key: "AI", autoRefine: false } });
    expect((await call("GET", "/api/projects/ai")).json).toMatchObject({ autoRefine: false });
    expect((await call("PATCH", "/api/projects/zz", { autoRefine: true })).status).toBe(404);
    expect((await call("PATCH", "/api/projects/ai", { autoRefine: "yes" })).status).toBe(400);
  });

  it("GivenAnInvalidBody_WhenCreatingATicket_Then400WithFieldPaths", async () => {
    await call("POST", "/api/projects", { name: "AI", key: "AI" });
    const res = await call("POST", "/api/projects/ai/tickets", { type: "nope", title: "" });
    expect(res.status).toBe(400);
    expect(res.json.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/^type:/), expect.stringMatching(/^title:/)]),
    );
  });

  it("GivenOnlyATitle_WhenCreatingATicket_ThenItIsCreatedWithNoType", async () => {
    await call("POST", "/api/projects", { name: "AI", key: "AI" });
    const res = await call("POST", "/api/projects/ai/tickets", { title: "Board" });
    expect(res).toMatchObject({ status: 201, json: { type: null, outOfScope: [], touches: [] } });
  });

  it("GivenAnOldTypeName_WhenCreatingATicket_Then400", async () => {
    await call("POST", "/api/projects", { name: "AI", key: "AI" });
    for (const type of ["story", "task"]) {
      expect((await call("POST", "/api/projects/ai/tickets", { type, title: "x" })).status).toBe(
        400,
      );
    }
  });

  it("GivenATicketWithNoType_WhenPatchedWithTypeAndScope_ThenTheyAreSaved", async () => {
    const t = await projectWithTicket({ type: undefined });
    const fields = { type: "bug", outOfScope: ["billing"], touches: ["apps/web/**"] };
    const res = await call("PATCH", `/api/projects/ai/tickets/${t.id}`, fields);
    expect(res).toMatchObject({ status: 200, json: fields });
    expect(
      (await call("PATCH", `/api/projects/ai/tickets/${t.id}`, { touches: Array(21).fill("a") }))
        .status,
    ).toBe(400);
  });

  it("GivenFlaggedTickets_WhenListedByNeedsAttention_ThenOnlyFlaggedOnesAreReturned", async () => {
    const t = await projectWithTicket();
    await call("POST", "/api/projects/ai/tickets", { title: "Other" });
    await call("POST", `/api/projects/ai/tickets/${t.id}/questions`, { text: "Which board?" });
    const res = await call("GET", "/api/projects/ai/tickets?needsAttention=true");
    expect(res.json.map((x) => (x as Ticket).key)).toEqual([t.key]);
  });

  it("GivenAClientSetDorStatus_WhenCreating_ThenIgnoredAndComputed", async () => {
    const ticket = await projectWithTicket({ dorStatus: "met", needsAttention: true });
    expect(ticket).toMatchObject({
      key: "AI-1",
      stage: "backlog",
      dorStatus: "not_met",
      needsAttention: false,
    });
  });

  it("GivenAnUnknownProject_WhenCreatingOrListingTickets_Then404", async () => {
    expect(
      (await call("POST", "/api/projects/zz/tickets", { type: "chore", title: "x" })).status,
    ).toBe(404);
    expect((await call("GET", "/api/projects/zz/tickets")).status).toBe(404);
  });

  it("GivenATicket_WhenPatchedToMeetDorAndMoved_ThenReadyWithHistory", async () => {
    const t = await projectWithTicket();
    const base = `/api/projects/ai/tickets/${t.id}`;

    const blocked = await call("POST", `${base}/stage`, { to: "ready" });
    expect(blocked.status).toBe(422);
    expect(blocked.json.details).toEqual(expect.arrayContaining(["size"]));
    expect(blocked.json.details).not.toContain("tier");

    const patched = await call("PATCH", base, readyFields);
    expect(patched.json).toMatchObject({ dorStatus: "met" });
    expect((await call("GET", `${base}/readiness`)).json).toEqual({ met: true, missing: [] });

    const moved = await call("POST", `${base}/stage`, { to: "ready" });
    expect(moved.status).toBe(200);
    expect(moved.json.stage).toBe("ready");
    expect((await call("GET", "/api/projects/ai/tickets?stage=ready")).json).toHaveLength(1);

    const kinds = ((await call("GET", `${base}/events`)).json as unknown as TicketEvent[]).map(
      (e) => e.kind,
    );
    expect(kinds).toEqual(["created", "fields_changed", "stage_changed"]);
  });

  it("GivenAStaleIfUpdatedAt_WhenPatching_Then409", async () => {
    const t = await projectWithTicket();
    await new Promise((r) => setTimeout(r, 5));
    await call("PATCH", `/api/projects/ai/tickets/${t.id}`, { title: "A" });
    const res = await call("PATCH", `/api/projects/ai/tickets/${t.id}`, {
      title: "B",
      ifUpdatedAt: t.updatedAt,
    });
    expect(res.status).toBe(409);
  });

  it("GivenAForcedMove_WhenNoReason_ThenMoved", async () => {
    const t = await projectWithTicket();
    const res = await call("POST", `/api/projects/ai/tickets/${t.id}/stage`, {
      to: "done",
      force: true,
    });
    expect(res.status).toBe(200);
    expect(res.json.stage).toBe("done");
  });

  it("GivenATicket_WhenCancelledThenArchived_ThenItIsHiddenUnlessArchivedIsAskedFor", async () => {
    const t = await projectWithTicket();
    const base = `/api/projects/ai/tickets/${t.id}`;
    expect((await call("POST", `${base}/archive`, {})).status).toBe(422);
    const cancelled = await call("POST", `${base}/cancel`, { reason: "dropped" });
    expect(cancelled).toMatchObject({ status: 200, json: { stage: "cancelled", archived: false } });
    expect((await call("POST", `${base}/archive`, {})).json.archived).toBe(true);
    expect((await call("GET", "/api/projects/ai/tickets?archived=false")).json).toEqual([]);
    expect((await call("GET", "/api/projects/ai/tickets?archived=true")).json).toHaveLength(1);
    expect((await call("POST", `${base}/cancel`, {})).status).toBe(422);
  });

  it("GivenAPatchThatSetsArchived_WhenPatching_ThenItIsIgnored", async () => {
    const t = await projectWithTicket();
    const res = await call("PATCH", `/api/projects/ai/tickets/${t.id}`, { archived: true });
    expect(res.json.archived).toBe(false);
  });

  it("GivenAQuestion_WhenAskedAndAnswered_ThenNeedsYouInboxFillsAndClears", async () => {
    const t = await projectWithTicket(readyFields);
    const base = `/api/projects/ai/tickets/${t.id}`;
    const asked = await call("POST", `${base}/questions`, {
      text: "Kanban or list?",
      options: ["kanban", "list"],
    });
    expect(asked.status).toBe(201);
    const q = asked.json as unknown as Question;

    const inbox = (await call("GET", "/api/needs-you")).json as unknown as {
      questions: Question[];
      tickets: Ticket[];
    };
    expect(inbox.questions.map((x) => x.id)).toEqual([q.id]);
    expect(inbox.tickets.map((x) => x.id)).toEqual([t.id]);
    expect((await call("GET", `${base}/questions`)).json).toHaveLength(1);

    const answered = await call("POST", `/api/questions/${q.id}/answer`, { answer: "kanban" });
    expect(answered.json).toMatchObject({ status: "answered", answeredVia: "ui" });
    expect((await call("POST", `/api/questions/${q.id}/answer`, { answer: "list" })).status).toBe(
      409,
    );
    expect((await call("GET", "/api/needs-you")).json).toEqual({ questions: [], tickets: [] });
    expect((await call("GET", base)).json).toMatchObject({
      needsAttention: false,
      dorStatus: "met",
    });
  });

  it("GivenACommentAndUnknownIds_WhenCalled_ThenCreatedOr404", async () => {
    const t = await projectWithTicket();
    const res = await call("POST", `/api/projects/ai/tickets/${t.id}/comments`, { body: "hi" });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ kind: "comment", actor: "andy", body: "hi" });
    const unknown = crypto.randomUUID();
    expect((await call("GET", `/api/projects/ai/tickets/${unknown}`)).status).toBe(404);
    expect((await call("GET", `/api/projects/ai/tickets/${unknown}/events`)).status).toBe(404);
    expect((await call("POST", `/api/questions/${unknown}/answer`, { answer: "x" })).status).toBe(
      404,
    );
  });

  it("GivenMalformedIds_WhenCalled_Then400NotAStorageError", async () => {
    await call("POST", "/api/projects", { name: "AI", key: "AI" });
    for (const path of [
      "/api/projects/__x__",
      "/api/projects/ai/tickets/a.b",
      "/api/projects/ai/tickets/__x__/events",
      "/api/projects/AI/tickets",
    ]) {
      expect((await call("GET", path)).status, path).toBe(400);
    }
    expect((await call("POST", "/api/questions/__x__/answer", { answer: "x" })).status).toBe(400);
  });

  it("GivenAClientSuppliedVia_WhenAnswering_ThenTheRouteSetsUi", async () => {
    const t = await projectWithTicket();
    const { json } = await call("POST", `/api/projects/ai/tickets/${t.id}/questions`, {
      text: "?",
    });
    const answered = await call("POST", `/api/questions/${String(json.id)}/answer`, {
      answer: "a",
      via: "mcp",
    });
    expect(answered.json.answeredVia).toBe("ui");
  });

  it("GivenAnOversizedBody_WhenPosted_Then413", async () => {
    await call("POST", "/api/projects", { name: "AI", key: "AI" });
    const res = await call("POST", "/api/projects/ai/tickets", {
      type: "chore",
      title: "big",
      body: "x".repeat(MAX_BODY_BYTES + 1),
    });
    expect(res.status).toBe(413);
  });

  it("GivenTheOpenApiDoc_WhenFetched_ThenTicketRoutesListed", async () => {
    const res = await app.request("/openapi.json");
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/api/projects/{projectId}/tickets",
        "/api/projects/{projectId}/tickets/{ticketId}/stage",
        "/api/projects/{projectId}/tickets/{ticketId}/cancel",
        "/api/projects/{projectId}/tickets/{ticketId}/archive",
        "/api/needs-you",
      ]),
    );
  });
});
