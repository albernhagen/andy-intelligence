import {
  InMemoryOAuthGrantStore,
  InMemoryWorkTracker,
  type NewTicket,
  type Ticket,
  type WorkTracker,
  InMemoryRunStore,
} from "@andy/contracts";
import { TicketService } from "@andy/domain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ClientMetadataResolver } from "./client-metadata";
import { hashToken, newToken } from "./tokens";

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;

// The UI's Firebase token: the bearer names the user (used for the REST cross-checks).
const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

const readyStory: NewTicket = {
  type: "story",
  title: "Board",
  body: "Andy can't see tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  size: "S",
  sizeReason: "one screen",
  tier: "strong",
};

/**
 * The app with MCP on, an access token already issued (the OAuth flow itself is covered in
 * flow.test.ts), and an MCP SDK client connected in-process.
 */
async function setup(tracker: WorkTracker = new InMemoryWorkTracker()) {
  const grants = new InMemoryOAuthGrantStore();
  const app = createApp({
    verifier,
    allowedEmails: parseAllowList("andy@example.com"),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs: new InMemoryRunStore(),
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
  return { tracker, service: new TicketService(tracker), call, rest };
}

async function withProject() {
  const ctx = await setup();
  await ctx.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  return ctx;
}

afterEach(() => vi.restoreAllMocks());

describe("create_ticket", () => {
  it("GivenAnIncompleteStory_WhenCreated_ThenItIsInBacklogWithDorGapsAndVisibleOverRest", async () => {
    const ctx = await withProject();
    const res = await ctx.call("create_ticket", { project: "ai", type: "story", title: "Board" });
    expect(res.isError).toBe(false);
    expect(res.data.ticket).toMatchObject({ key: "AI-1", stage: "backlog", dorStatus: "not_met" });
    expect(res.data.readiness.missing).toEqual(
      expect.arrayContaining(["problem/intent in the body", "acceptance criteria"]),
    );

    const list = (await (await ctx.rest("/api/projects/ai/tickets")).json()) as Ticket[];
    expect(list).toEqual([expect.objectContaining({ key: "AI-1", title: "Board" })]);
    const events = await ctx.tracker.listEvents("ai", list[0]!.id);
    expect(events[0]).toMatchObject({ kind: "created", actor: "andy" });
  });

  it("GivenDerivedFieldsInTheInput_WhenCreated_ThenTheDomainComputesThemInstead", async () => {
    const ctx = await withProject();
    const res = await ctx.call("create_ticket", {
      project: "AI",
      ...readyStory,
      needsYou: true,
      dorStatus: "not_met",
    });
    expect(res.data.ticket).toMatchObject({ needsYou: false, dorStatus: "met" });
  });

  it("GivenAnUnknownProject_WhenCreating_ThenAToolErrorNamesIt", async () => {
    const ctx = await withProject();
    const res = await ctx.call("create_ticket", { project: "ZZ", type: "task", title: "x" });
    expect(res).toMatchObject({ isError: true, text: "project not found: zz" });
  });

  it("GivenInvalidInput_WhenCreating_ThenAToolErrorAndNothingIsStored", async () => {
    const ctx = await withProject();
    for (const args of [
      { project: "AI", type: "story" },
      { project: "AI", type: "chore", title: "x" },
      { project: "../x", type: "task", title: "x" },
    ]) {
      expect((await ctx.call("create_ticket", args)).isError).toBe(true);
    }
    expect(await ctx.tracker.listTickets("ai")).toEqual([]);
  });
});

describe("list_needs_me", () => {
  it("GivenNothingOpen_WhenListed_ThenTheInboxIsEmpty", async () => {
    const ctx = await withProject();
    expect((await ctx.call("list_needs_me")).data).toEqual({ questions: [], tickets: [] });
  });

  it("GivenAnAgentQuestion_WhenListed_ThenItShowsWithItsTicketKeyAndTheTicketIsFlagged", async () => {
    const ctx = await withProject();
    const t = await ctx.service.create("ai", readyStory, "andy");
    const q = await ctx.service.ask(
      "ai",
      t.id,
      { text: "Which board?", options: ["Kanban", "List"], urgency: "high" },
      "agent:r1",
    );

    const res = await ctx.call("list_needs_me");
    expect(res.data.questions).toEqual([
      expect.objectContaining({
        id: q.id,
        ticket: "AI-1",
        text: "Which board?",
        options: ["Kanban", "List"],
        urgency: "high",
      }),
    ]);
    expect(res.data.tickets).toEqual([expect.objectContaining({ key: "AI-1", needsYou: true })]);
  });
});

describe("answer_question", () => {
  it("GivenTheLastOpenQuestion_WhenAnswered_ThenRecordedViaMcpAndNeedsYouClears", async () => {
    const ctx = await withProject();
    const t = await ctx.service.create("ai", readyStory, "andy");
    const q = await ctx.service.ask("ai", t.id, { text: "Which board?" }, "agent:r1");

    const res = await ctx.call("answer_question", { questionId: q.id, answer: "Kanban" });
    expect(res.isError).toBe(false);
    expect(res.data.question).toMatchObject({
      status: "answered",
      answer: "Kanban",
      answeredVia: "mcp",
    });
    expect(res.data.ticket).toMatchObject({ key: "AI-1", needsYou: false, dorStatus: "met" });
    expect((await ctx.call("list_needs_me")).data).toEqual({ questions: [], tickets: [] });
  });

  it("GivenAnAnsweredOrUnknownQuestion_WhenAnswered_ThenAToolError", async () => {
    const ctx = await withProject();
    const t = await ctx.service.create("ai", readyStory, "andy");
    const q = await ctx.service.ask("ai", t.id, { text: "Which board?" }, "agent:r1");
    await ctx.call("answer_question", { questionId: q.id, answer: "Kanban" });

    expect((await ctx.call("answer_question", { questionId: q.id, answer: "List" })).isError).toBe(
      true,
    );
    const unknown = await ctx.call("answer_question", {
      questionId: "00000000-0000-4000-8000-000000000000",
      answer: "x",
    });
    expect(unknown).toMatchObject({ isError: true, text: expect.stringMatching(/not found/) });
    expect((await ctx.call("answer_question", { questionId: q.id, answer: "   " })).isError).toBe(
      true,
    );
  });
});

describe("status", () => {
  it("GivenNoTicket_WhenCalled_ThenAnOverviewOfProjectsStagesAndTheInbox", async () => {
    const ctx = await withProject();
    await ctx.service.create("ai", { type: "task", title: "x" }, "andy");
    const res = await ctx.call("status");
    expect(res.data).toEqual({
      signedInAs: "andy@example.com",
      projects: [
        {
          key: "AI",
          name: "Andy Intelligence",
          ticketsByStage: {
            backlog: 1,
            ready: 0,
            in_progress: 0,
            ready_for_review: 0,
            monitoring: 0,
            done: 0,
            cancelled: 0,
          },
        },
      ],
      needsYou: { questions: 0, tickets: 0 },
    });
  });

  it("GivenATicketKey_WhenCalled_ThenItShowsStageReadinessQuestionsAndHistory", async () => {
    const ctx = await withProject();
    const t = await ctx.service.create("ai", readyStory, "andy");
    await ctx.service.ask("ai", t.id, { text: "Which board?" }, "agent:r1");
    const res = await ctx.call("status", { ticket: "AI-1" });
    expect(res.data.ticket).toMatchObject({ key: "AI-1", stage: "backlog", needsYou: true });
    expect(res.data.readiness).toEqual({ met: false, missing: ["1 open question(s) answered"] });
    expect(res.data.questions).toHaveLength(1);
    expect(res.data.recentEvents.map((e: { kind: string }) => e.kind)).toEqual([
      "created",
      "question_asked",
      "fields_changed",
    ]);
  });

  it("GivenAnUnknownOrMalformedKey_WhenCalled_ThenAToolError", async () => {
    const ctx = await withProject();
    expect(await ctx.call("status", { ticket: "AI-9" })).toMatchObject({
      isError: true,
      text: "ticket not found: AI-9",
    });
    expect((await ctx.call("status", { ticket: "not a key" })).isError).toBe(true);
  });

  it("GivenAStorageFailure_WhenCalled_ThenItIsLoggedAndTheCallerSeesOnlyInternalError", async () => {
    const tracker = new InMemoryWorkTracker();
    vi.spyOn(tracker, "listProjects").mockRejectedValue(new Error("firestore down at /secret"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = await setup(tracker);

    expect(await ctx.call("status")).toMatchObject({ isError: true, text: "internal error" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"component":"mcp-tools"'));
  });
});

describe("refine tool", () => {
  it("GivenGitHubIsNotConnected_WhenRefineIsCalled_ThenAToolErrorSaysSo", async () => {
    const ctx = await withProject();
    await ctx.call("create_ticket", { project: "AI", type: "story", title: "Board" });
    const result = await ctx.call("refine", { ticket: "AI-1" });
    expect(result).toMatchObject({
      isError: true,
      text: expect.stringContaining("connect GitHub"),
    });
  });

  it("GivenAnUnknownTicket_WhenRefineIsCalled_ThenAToolErrorSaysNotFound", async () => {
    const ctx = await withProject();
    const result = await ctx.call("refine", { ticket: "AI-9" });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("not found") });
  });
});

describe("set_auto_refine tool", () => {
  it("GivenAProject_WhenAutoRefineIsTurnedOffThenOn_ThenTheSettingIsStored", async () => {
    const ctx = await withProject();
    expect((await ctx.call("set_auto_refine", { project: "ai", enabled: false })).data).toEqual({
      project: "AI",
      autoRefine: false,
    });
    expect((await ctx.call("set_auto_refine", { project: "AI", enabled: true })).data).toEqual({
      project: "AI",
      autoRefine: true,
    });
  });

  it("GivenAnUnknownProject_WhenSet_ThenAToolErrorSaysNotFound", async () => {
    const ctx = await withProject();
    const result = await ctx.call("set_auto_refine", { project: "ZZ", enabled: true });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("not found") });
  });
});

describe("cancel_ticket and archive_ticket", () => {
  it("GivenATicket_WhenCancelledAndArchivedOverMcp_ThenStatusCountsLeaveItOut", async () => {
    const ctx = await withProject();
    await ctx.call("create_ticket", { project: "AI", type: "task", title: "x" });
    const cancelled = await ctx.call("cancel_ticket", { ticket: "AI-1", reason: "not needed" });
    expect(cancelled.data.ticket).toMatchObject({ stage: "cancelled", archived: false });
    const status = await ctx.call("status", { ticket: "AI-1" });
    expect(status.data.recentEvents.at(-1)).toMatchObject({ actor: "andy", body: "not needed" });

    const archived = await ctx.call("archive_ticket", { ticket: "AI-1" });
    expect(archived.data.ticket).toMatchObject({ archived: true });
    const overview = await ctx.call("status");
    expect(overview.data.projects[0].ticketsByStage.cancelled).toBe(0);
  });

  it("GivenACancelledTicket_WhenMoveTicketReopensIt_ThenAToolErrorAndItStaysCancelled", async () => {
    const ctx = await withProject();
    await ctx.call("create_ticket", { project: "AI", type: "task", title: "x" });
    await ctx.call("cancel_ticket", { ticket: "AI-1" });
    const res = await ctx.call("move_ticket", { ticket: "AI-1", to: "backlog" });
    expect(res).toMatchObject({ isError: true, text: expect.stringMatching(/one step forward/) });
    const status = await ctx.call("status", { ticket: "AI-1" });
    expect(status.data.ticket.stage).toBe("cancelled");
  });

  it("GivenATicketNotDoneOrCancelled_WhenArchivedOverMcp_ThenAToolError", async () => {
    const ctx = await withProject();
    await ctx.call("create_ticket", { project: "AI", type: "task", title: "x" });
    const res = await ctx.call("archive_ticket", { ticket: "AI-1" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("only Done or Cancelled");
  });

  it("GivenAnUnknownTicket_WhenCancelledOverMcp_ThenAToolError", async () => {
    const ctx = await withProject();
    expect(await ctx.call("cancel_ticket", { ticket: "AI-9" })).toMatchObject({
      isError: true,
      text: "ticket not found: AI-9",
    });
  });
});

describe("move_ticket", () => {
  it("GivenAReadyTicket_WhenMovedOneStepForward_ThenMovedUnforcedAndVisibleOverRest", async () => {
    const ctx = await withProject();
    const t = await ctx.service.create("ai", readyStory, "andy");
    await ctx.service.move("ai", t.id, "ready", "andy");
    const res = await ctx.call("move_ticket", { ticket: "AI-1", to: "in_progress" });
    expect(res).toMatchObject({ isError: false, data: { ticket: { stage: "in_progress" } } });
    const events = await ctx.tracker.listEvents("ai", t.id);
    expect(events.at(-1)).toMatchObject({ kind: "stage_changed", data: { forced: false } });
    const body = (await (await ctx.rest(`/api/projects/ai/tickets/${t.id}`)).json()) as Ticket;
    expect(body.stage).toBe("in_progress");
  });

  it("GivenABackwardOrSkippingMove_WhenCalled_ThenAToolErrorAndTheTicketIsUnchanged", async () => {
    const ctx = await withProject();
    const t = await ctx.service.create("ai", readyStory, "andy");
    await ctx.service.move("ai", t.id, "ready", "andy");
    for (const to of ["backlog", "ready_for_review", "done"]) {
      const res = await ctx.call("move_ticket", { ticket: "AI-1", to });
      expect(res).toMatchObject({ isError: true, text: expect.stringMatching(/one step forward/) });
    }
    expect((await ctx.tracker.getTicket("ai", t.id))?.stage).toBe("ready");
  });

  it("GivenAnIncompleteStory_WhenMovedToReady_ThenAToolErrorNamesTheDorGaps", async () => {
    const ctx = await withProject();
    await ctx.service.create("ai", { type: "story", title: "x" }, "andy");
    const res = await ctx.call("move_ticket", { ticket: "AI-1", to: "ready" });
    expect(res).toMatchObject({
      isError: true,
      text: expect.stringMatching(/^Definition of Ready not met: /),
    });
  });

  it("GivenAnUnknownKeyOrAForceArgument_WhenCalled_ThenAToolErrorOrForceIsIgnored", async () => {
    const ctx = await withProject();
    expect(await ctx.call("move_ticket", { ticket: "AI-9", to: "ready" })).toMatchObject({
      isError: true,
      text: "ticket not found: AI-9",
    });
    const t = await ctx.service.create("ai", readyStory, "andy");
    const res = await ctx.call("move_ticket", { ticket: "AI-1", to: "done", force: true });
    expect(res.isError).toBe(true);
    expect((await ctx.tracker.getTicket("ai", t.id))?.stage).toBe("backlog");
  });
});

describe("M1 flow from Claude desktop", () => {
  it("GivenATicketCreatedOverMcp_WhenAnAgentAsksAndAndyAnswersOverMcp_ThenItMovesToReady", async () => {
    const ctx = await withProject();
    const created = await ctx.call("create_ticket", { project: "AI", ...readyStory });
    const id = (await ctx.service.findByKey(created.data.ticket.key)).id;
    await ctx.service.ask("ai", id, { text: "Which board?" }, "agent:r1");

    const [question] = (await ctx.call("list_needs_me")).data.questions;
    const answered = await ctx.call("answer_question", {
      questionId: question.id,
      answer: "Kanban",
    });
    expect(answered.data.ticket).toMatchObject({
      stage: "ready",
      needsYou: false,
      dorStatus: "met",
    });
    expect((await ctx.call("status", { ticket: "AI-1" })).data.readiness).toEqual({
      met: true,
      missing: [],
    });
  });
});
