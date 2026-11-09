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
  type: "feature",
  title: "Board",
  body: "Andy can't see tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  size: "S",
  sizeReason: "one screen",
};

/**
 * The app with MCP on, an access token already issued (the OAuth flow itself is covered in
 * flow.test.ts), and an MCP SDK client connected in-process.
 */
async function setup(tracker: WorkTracker = new InMemoryWorkTracker()) {
  const grants = new InMemoryOAuthGrantStore();
  const runs = new InMemoryRunStore();
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
  return { tracker, runs, service: new TicketService(tracker), call, rest };
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
    const res = await ctx.call("create_ticket", { project: "ai", type: "feature", title: "Board" });
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

  it("GivenOnlyATitle_WhenCreated_ThenTheTicketHasNoTypeAndReadinessAsksForOne", async () => {
    const ctx = await withProject();
    const res = await ctx.call("create_ticket", { project: "AI", title: "Board" });
    expect(res.isError).toBe(false);
    expect(res.data.ticket).toMatchObject({ key: "AI-1", type: null, needsAttention: false });
    expect(res.data.readiness.missing).toEqual(expect.arrayContaining(["type"]));
  });

  it("GivenScopeLists_WhenCreated_ThenTheyAreStored", async () => {
    const ctx = await withProject();
    const scope = { outOfScope: ["the UI"], touches: ["apps/api/**"] };
    await ctx.call("create_ticket", { project: "AI", type: "chore", title: "x", ...scope });
    expect((await ctx.tracker.listTickets("ai"))[0]).toMatchObject(scope);
  });

  it("GivenDerivedFieldsInTheInput_WhenCreated_ThenTheDomainComputesThemInstead", async () => {
    const ctx = await withProject();
    const res = await ctx.call("create_ticket", {
      project: "AI",
      ...readyStory,
      needsAttention: true,
      dorStatus: "not_met",
    });
    expect(res.data.ticket).toMatchObject({ needsAttention: false, dorStatus: "met" });
  });

  it("GivenAnUnknownProject_WhenCreating_ThenAToolErrorNamesIt", async () => {
    const ctx = await withProject();
    const res = await ctx.call("create_ticket", { project: "ZZ", type: "chore", title: "x" });
    expect(res).toMatchObject({ isError: true, text: "project not found: zz" });
  });

  it("GivenInvalidInput_WhenCreating_ThenAToolErrorAndNothingIsStored", async () => {
    const ctx = await withProject();
    for (const args of [
      { project: "AI", type: "feature" },
      { project: "AI", type: "story", title: "x" },
      { project: "AI", type: "task", title: "x" },
      { project: "../x", type: "chore", title: "x" },
    ]) {
      expect((await ctx.call("create_ticket", args)).isError).toBe(true);
    }
    expect(await ctx.tracker.listTickets("ai")).toEqual([]);
  });
});

describe("list_needs_me", () => {
  it("GivenNothingOpen_WhenListed_ThenTheInboxIsEmpty", async () => {
    const ctx = await withProject();
    expect((await ctx.call("list_needs_me")).data).toEqual({
      cards: [],
      questions: [],
      tickets: [],
    });
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
    expect(res.data.tickets).toEqual([
      expect.objectContaining({ key: "AI-1", needsAttention: true }),
    ]);
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
    expect(res.data.ticket).toMatchObject({ key: "AI-1", needsAttention: false, dorStatus: "met" });
    expect((await ctx.call("list_needs_me")).data).toEqual({
      cards: [],
      questions: [],
      tickets: [],
    });
  });

  it("GivenAQuestionAskedByARun_WhenAnswered_ThenRecordedAndTheTicketIsReady", async () => {
    const ctx = await withProject();
    const t = await ctx.service.create("ai", readyStory, "andy", { upNext: true });
    // AI-27: a run's question id is `<runId>-q<n>`, not a UUID.
    const [q] = await ctx.tracker.askQuestions(
      "ai",
      t.id,
      [{ text: "Which board?" }],
      "agent:run7",
      "run7",
    );
    expect(q?.id).toBe("run7-q1");

    const res = await ctx.call("answer_question", { questionId: q?.id, answer: "Kanban" });
    expect(res.isError).toBe(false);
    expect(res.data.question).toMatchObject({ status: "answered", answeredVia: "mcp" });
    expect(res.data.ticket).toMatchObject({ key: "AI-1", stage: "ready", needsAttention: false });
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
    await ctx.service.create("ai", { type: "chore", title: "x" }, "andy");
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
            done: 0,
            cancelled: 0,
          },
          dispatch: { runsAtOnce: 2, paused: false, lastDispatch: null },
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
    expect(res.data.ticket).toMatchObject({ key: "AI-1", stage: "backlog", needsAttention: true });
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
    await ctx.call("create_ticket", {
      project: "AI",
      type: "feature",
      title: "Board",
      upNext: true,
    });
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

describe("build tool", () => {
  it("GivenGitHubIsNotConnected_WhenBuildIsCalled_ThenAToolErrorSaysSo", async () => {
    const ctx = await withProject();
    await ctx.call("create_ticket", { project: "AI", type: "feature", title: "Board" });
    const result = await ctx.call("build", { ticket: "AI-1" });
    expect(result).toMatchObject({
      isError: true,
      text: expect.stringContaining("connect GitHub"),
    });
  });
});

describe("Up next and assumptions", () => {
  const ratedResult = {
    assumptions: [
      {
        id: "r1-a1",
        text: "Assume kanban",
        question: "Kanban?",
        options: [],
        cost: "reversible",
        confidence: "sure",
        demotedBy: null,
        runId: "r1",
        status: "assumed",
        questionId: null,
        answeredAt: null,
        settledBy: null,
        createdAt: "2026-11-08T00:00:00.000Z",
      },
    ],
  };

  it("GivenNoFlag_WhenCreated_ThenTheTicketIsAnIdea", async () => {
    const ctx = await withProject();
    await ctx.call("create_ticket", { project: "AI", title: "Board" });
    expect((await ctx.tracker.listTickets("ai"))[0]?.upNextRank).toBeNull();
  });

  it("GivenTheFlag_WhenCreated_ThenTheTicketIsUpNext", async () => {
    const ctx = await withProject();
    await ctx.call("create_ticket", { project: "AI", title: "Board", upNext: true });
    expect((await ctx.tracker.listTickets("ai"))[0]?.upNextRank).not.toBeNull();
  });

  it("GivenAnAssumption_WhenPromotedAndReadOverStatus_ThenItIsAnOpenQuestion", async () => {
    const ctx = await withProject();
    await ctx.call("create_ticket", { project: "AI", title: "Board", upNext: true });
    const [t] = await ctx.tracker.listTickets("ai");
    await ctx.tracker.updateTicket(
      "ai",
      t!.id,
      { fields: { refineAssumptions: ratedResult.assumptions as never } },
      "system",
    );
    const before = await ctx.call("status", { ticket: "AI-1" });
    expect(before.text).toContain("Assume kanban");

    const res = await ctx.call("promote_assumption", { ticket: "AI-1", assumptionId: "r1-a1" });
    expect(res.isError).toBeFalsy();
    expect(await ctx.tracker.listQuestions({ ticketId: t!.id, status: "open" })).toHaveLength(1);
    expect(
      (await ctx.call("promote_assumption", { ticket: "AI-1", assumptionId: "r1-a1" })).isError,
    ).toBe(true);
  });
});

describe("set_auto_build tool", () => {
  it("GivenAProject_WhenAutoBuildIsTurnedOn_ThenItIsStoredAndAutoRefineIsUntouched", async () => {
    const ctx = await withProject();
    await ctx.call("set_auto_refine", { project: "AI", enabled: false });
    expect(await ctx.call("set_auto_build", { project: "AI", enabled: true })).toMatchObject({
      isError: true,
      text: expect.stringContaining("builds are off"),
    });
    await ctx.rest("/api/projects/ai", {
      method: "PATCH",
      body: JSON.stringify({ buildEnabled: true }),
    });
    expect((await ctx.call("set_auto_build", { project: "AI", enabled: true })).data).toEqual({
      project: "AI",
      autoBuild: true,
    });
    const projects = (await (await ctx.rest("/api/projects")).json()) as {
      autoRefine: boolean;
      autoBuild: boolean;
    }[];
    expect(projects[0]).toMatchObject({ autoRefine: false, autoBuild: true });
  });
});

describe("plan approval tools", () => {
  it("GivenAProject_WhenPlanApprovalIsSet_ThenItIsStoredAndShownOverRest", async () => {
    const ctx = await withProject();
    expect(
      (await ctx.call("set_plan_approval", { project: "ai", policy: "m-and-l" })).data,
    ).toEqual({ project: "AI", planApproval: "m-and-l" });
    const projects = (await (await ctx.rest("/api/projects")).json()) as { planApproval: string }[];
    expect(projects[0]!.planApproval).toBe("m-and-l");
    expect(await ctx.call("set_plan_approval", { project: "AI", policy: "some" })).toMatchObject({
      isError: true,
    });
  });

  it("GivenAProject_WhenSetAutoMergeIsCalled_ThenThePolicyIsSavedAndBadValuesRefused", async () => {
    const ctx = await withProject();
    expect((await ctx.call("set_auto_merge", { project: "ai", policy: "none" })).data).toEqual({
      project: "AI",
      autoMerge: "none",
    });
    const projects = (await (await ctx.rest("/api/projects")).json()) as { autoMerge: string }[];
    expect(projects[0]!.autoMerge).toBe("none");
    expect(await ctx.call("set_auto_merge", { project: "AI", policy: "some" })).toMatchObject({
      isError: true,
    });
  });

  it("GivenAStoredDispatchDecision_WhenStatusOverview_ThenItShowsTheReason", async () => {
    const ctx = await withProject();
    const lastDispatch = { decision: "global_cap", at: "2026-11-09T12:00:00.000Z" } as const;
    await ctx.tracker.updateProject("ai", { lastDispatch });
    const overview = await ctx.call("status");
    expect(overview.data.projects[0].dispatch).toEqual({
      runsAtOnce: 2,
      paused: false,
      lastDispatch,
    });
  });

  it("GivenTheDialAndPauseTools_WhenCalled_ThenTheProjectStoresThem", async () => {
    const ctx = await withProject();
    expect((await ctx.call("set_runs_at_once", { project: "ai", runs: 3 })).data).toEqual({
      project: "AI",
      runsAtOnce: 3,
    });
    expect((await ctx.call("set_paused", { project: "ai", paused: true })).data).toEqual({
      project: "AI",
      paused: true,
    });
    expect(await ctx.tracker.getProject("ai")).toMatchObject({ runsAtOnce: 3, paused: true });
  });

  it("GivenADialOverTheMaximum_WhenSet_ThenAToolError", async () => {
    const ctx = await withProject();
    expect(await ctx.call("set_runs_at_once", { project: "AI", runs: 5 })).toMatchObject({
      isError: true,
    });
    expect(await ctx.tracker.getProject("ai")).toMatchObject({ runsAtOnce: 2 });
  });

  it("GivenATicketWithoutAPlan_WhenApproveOrRejectIsCalled_ThenAToolErrorSaysSo", async () => {
    const ctx = await withProject();
    const created = await ctx.call("create_ticket", { project: "AI", title: "Board" });
    const key = (created.data as { ticket: { key: string } }).ticket.key;
    expect(await ctx.call("approve_plan", { ticket: key })).toMatchObject({
      isError: true,
      text: expect.stringContaining("no plan to decide"),
    });
    expect(await ctx.call("reject_plan", { ticket: key, reason: "too big" })).toMatchObject({
      isError: true,
      text: expect.stringContaining("no plan to decide"),
    });
  });

  it("GivenNoReason_WhenRejectPlanIsCalled_ThenItIsRefusedByTheSchema", async () => {
    const ctx = await withProject();
    expect(await ctx.call("reject_plan", { ticket: "AI-1", reason: "  " })).toMatchObject({
      isError: true,
    });
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
    await ctx.call("create_ticket", { project: "AI", type: "chore", title: "x" });
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
    await ctx.call("create_ticket", { project: "AI", type: "chore", title: "x" });
    await ctx.call("cancel_ticket", { ticket: "AI-1" });
    const res = await ctx.call("move_ticket", { ticket: "AI-1", to: "backlog" });
    expect(res).toMatchObject({ isError: true, text: expect.stringMatching(/one step forward/) });
    const status = await ctx.call("status", { ticket: "AI-1" });
    expect(status.data.ticket.stage).toBe("cancelled");
  });

  it("GivenATicketNotDoneOrCancelled_WhenArchivedOverMcp_ThenAToolError", async () => {
    const ctx = await withProject();
    await ctx.call("create_ticket", { project: "AI", type: "chore", title: "x" });
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

  it("GivenATicketInReview_WhenMovedToMonitoring_ThenAToolErrorAndTheTicketIsUnchanged", async () => {
    const ctx = await withProject();
    const t = await ctx.service.create("ai", readyStory, "andy");
    await ctx.service.move("ai", t.id, "ready_for_review", "andy", { force: true });
    const res = await ctx.call("move_ticket", { ticket: "AI-1", to: "monitoring" });
    expect(res.isError).toBe(true);
    expect((await ctx.tracker.getTicket("ai", t.id))?.stage).toBe("ready_for_review");
  });

  it("GivenATicketInReview_WhenMovedToDone_ThenDoneInOneStep", async () => {
    const ctx = await withProject();
    const t = await ctx.service.create("ai", readyStory, "andy");
    await ctx.service.move("ai", t.id, "ready_for_review", "andy", { force: true });
    const res = await ctx.call("move_ticket", { ticket: "AI-1", to: "done" });
    expect(res).toMatchObject({ isError: false, data: { ticket: { stage: "done" } } });
  });

  it("GivenAnIncompleteStory_WhenMovedToReady_ThenAToolErrorNamesTheDorGaps", async () => {
    const ctx = await withProject();
    await ctx.service.create("ai", { type: "feature", title: "x" }, "andy");
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
    const created = await ctx.call("create_ticket", {
      project: "AI",
      ...readyStory,
      upNext: true,
    });
    const id = (await ctx.service.findByKey(created.data.ticket.key)).id;
    await ctx.service.ask("ai", id, { text: "Which board?" }, "agent:r1");

    const [question] = (await ctx.call("list_needs_me")).data.questions;
    const answered = await ctx.call("answer_question", {
      questionId: question.id,
      answer: "Kanban",
    });
    expect(answered.data.ticket).toMatchObject({
      stage: "ready",
      needsAttention: false,
      dorStatus: "met",
    });
    expect((await ctx.call("status", { ticket: "AI-1" })).data.readiness).toEqual({
      met: true,
      missing: [],
    });
  });
});

describe("list_ready", () => {
  /** Three Ready tickets in rank order, then one left in Backlog. */
  async function withQueue() {
    const ctx = await withProject();
    const add = async (title: string, stage: "ready" | "backlog", fields: object) => {
      const t = await ctx.service.create("ai", { ...readyStory, title }, "andy");
      await ctx.tracker.updateTicket(
        "ai",
        t.id,
        { fields, stage: { to: stage, forced: false, reason: null } },
        "system",
      );
      return t;
    };
    const lowHigh = {
      risk: "low",
      riskReason: "small",
      confidence: "high",
      confidenceReason: "ok",
    };
    await add("Risky", "ready", { ...lowHigh, risk: "high", riskReason: "auth" });
    await add("Easy", "ready", lowHigh);
    await add("Old", "ready", {});
    await add("Parked", "backlog", lowHigh);
    return ctx;
  }

  it("GivenReadyTickets_WhenListed_ThenBoardRankOrderWithScoresAndNothingElse", async () => {
    const ctx = await withQueue();
    const res = await ctx.call("list_ready", { project: "ai" });
    expect(res.data.total).toBe(3);
    expect(res.data.tickets.map((t: { title: string }) => t.title)).toEqual([
      "Risky",
      "Easy",
      "Old",
    ]);
    expect(res.data.tickets[1]).toMatchObject({
      key: "AI-2",
      score: "S · low risk · confident",
      size: "S",
      risk: "low",
      riskReason: "small",
      confidence: "high",
      confidenceReason: "ok",
    });
    expect(res.data.tickets[2]).toMatchObject({ score: "S", risk: null, confidence: null });
  });

  it("GivenFilters_WhenListed_ThenOnlyMatchingTicketsAndUnscoredOnesDontMatch", async () => {
    const ctx = await withQueue();
    const res = await ctx.call("list_ready", {
      project: "ai",
      size: "S",
      risk: "low",
      confidence: "high",
    });
    expect(res.data.tickets.map((t: { title: string }) => t.title)).toEqual(["Easy"]);
    const none = await ctx.call("list_ready", { project: "ai", size: "L" });
    expect(none.data).toEqual({ total: 0, tickets: [] });
  });

  it("GivenAnUnknownProject_WhenListed_ThenAToolError", async () => {
    const ctx = await withProject();
    const res = await ctx.call("list_ready", { project: "NOPE" });
    expect(res).toMatchObject({ isError: true, text: "project NOPE not found" });
  });

  it("GivenAScoredTicket_WhenStatusIsRead_ThenItCarriesTheFieldsAndTheLabel", async () => {
    const ctx = await withQueue();
    const res = await ctx.call("status", { ticket: "AI-2" });
    expect(res.data.score).toBe("S · low risk · confident");
    expect(res.data.ticket).toMatchObject({ risk: "low", riskReason: "small", confidence: "high" });
  });
});

describe("list_in_flight", () => {
  it("GivenABuildInFlightOverlappingAReadyTicket_WhenListed_ThenItShowsAndTheTicketsStatusSaysWhy", async () => {
    const ctx = await withProject();
    const add = async (title: string, touches: string[]) => {
      const t = await ctx.service.create("ai", { ...readyStory, title, touches }, "andy");
      await ctx.tracker.updateTicket(
        "ai",
        t.id,
        { stage: { to: "ready", forced: false, reason: null } },
        "system",
      );
      return t;
    };
    const building = await add("Building", ["packages/domain/**"]);
    await add("Waiting", ["packages/domain/src/runs.ts"]);
    await ctx.runs.create({
      projectId: "ai",
      ticketId: building.id,
      step: "build",
      route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      tier: "fast",
      deadline: null,
      prompt: "x",
      maxTurns: 1,
      touches: ["packages/domain/**"],
      reservedAdr: 83,
    });

    const res = await ctx.call("list_in_flight", { project: "ai" });
    expect(res.data.runs).toEqual([
      expect.objectContaining({
        ticketKey: "AI-1",
        step: "build",
        status: "queued",
        touches: ["packages/domain/**"],
        reservedAdr: 83,
        pullRequest: null,
      }),
    ]);
    const status = await ctx.call("status", { ticket: "AI-2" });
    expect(status.data.statusLine.text).toBe("Waiting: overlaps AI-1 in flight");
  });

  it("GivenAnUnknownProject_WhenListed_ThenAToolError", async () => {
    const ctx = await withProject();
    const res = await ctx.call("list_in_flight", { project: "NOPE" });
    expect(res).toMatchObject({ isError: true, text: "project NOPE not found" });
  });
});
