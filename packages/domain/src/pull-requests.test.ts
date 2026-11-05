import {
  InMemoryWorkTracker,
  type CodeHostEvent,
  type NewTicket,
  type Project,
  type PullRequest,
  type Stage,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { PullRequestTickets, outcomeOf, ticketKeyFor } from "./pull-requests";
import { TicketService } from "./tickets";

const readyStory: NewTicket = {
  type: "feature",
  title: "Board",
  body: "Andy can't see tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  size: "S",
  sizeReason: "one screen",
};

type PrEvent = Extract<CodeHostEvent, { kind: "pull_request" }>;

const prEvent = (action: string, pr: Partial<PullRequest> = {}): PrEvent => ({
  kind: "pull_request",
  deliveryId: "d-1",
  projectId: "ai",
  repo: "albernhagen/andy-intelligence",
  action,
  receivedAt: "2026-11-04T12:00:00.000Z",
  pullRequest: {
    number: 70,
    state: "open",
    draft: false,
    title: "AI-1: something",
    bodyFirstLine: "",
    fromFork: false,
    intoDefaultBranch: true,
    headRef: "AI-1/something",
    headSha: "abc",
    baseRef: "main",
    url: "https://github.com/albernhagen/andy-intelligence/pull/70",
    ...pr,
  },
});

describe("ticketKeyFor", () => {
  it("GivenAKeyInTheBranch_WhenResolved_ThenThatKey", () => {
    expect(ticketKeyFor("AI", { headRef: "AI-14-pr-moves", bodyFirstLine: "" })).toBe("AI-14");
    expect(ticketKeyFor("AI", { headRef: "feat/AI-7", bodyFirstLine: "AI-9" })).toBe("AI-7");
  });

  it("GivenNoKeyInTheBranch_WhenTheBodyLinksTheTicket_ThenTheKeyFromTheLink", () => {
    expect(
      ticketKeyFor("AI", {
        headRef: "m1.x/pr-ticket-moves",
        bodyFirstLine: "https://ai.andybernhagen.com/p/ai/t/AI-14",
      }),
    ).toBe("AI-14");
  });

  it("GivenOtherProjectsKeysOrLookAlikes_WhenResolved_ThenSkipped", () => {
    expect(ticketKeyFor("AI", { headRef: "SHA-256", bodyFirstLine: "OPS-3 then AI-4" })).toBe(
      "AI-4",
    );
    expect(ticketKeyFor("AI", { headRef: "xAI-1", bodyFirstLine: "AI-1x ai-2 AI-" })).toBeNull();
  });
});

describe("outcomeOf", () => {
  it("GivenPullRequestActions_WhenClassified_ThenOpenedMergedClosedOrNothing", () => {
    expect(outcomeOf("opened", { state: "open" })).toBe("opened");
    expect(outcomeOf("ready_for_review", { state: "open" })).toBe("opened");
    expect(outcomeOf("reopened", { state: "open" })).toBe("opened");
    expect(outcomeOf("closed", { state: "merged" })).toBe("merged");
    expect(outcomeOf("closed", { state: "closed" })).toBe("closed");
    expect(outcomeOf("synchronize", { state: "open" })).toBeNull();
    expect(outcomeOf("edited", { state: "open" })).toBeNull();
  });
});

describe("PullRequestTickets", () => {
  let tracker: InMemoryWorkTracker;
  let service: TicketService;
  let prs: PullRequestTickets;
  let project: Project;

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    service = new TicketService(tracker);
    prs = new PullRequestTickets(service, tracker);
    project = await tracker.createProject({ name: "AI", key: "AI" });
  });

  /** AI-1 at `stage`, reached by Andy's forced move. */
  async function ticketAt(stage: Stage): Promise<Ticket> {
    const t = await service.create(project.id, readyStory, "andy");
    if (stage === "backlog") return t;
    return service.move(project.id, t.id, stage, "andy", { force: true, reason: "setup" });
  }

  const reload = async (t: Ticket) => (await tracker.getTicket(project.id, t.id))!;
  const systemEvents = async (t: Ticket) =>
    (await tracker.listEvents(project.id, t.id)).filter((e) => e.actor === "system");

  it("GivenAnInProgressTicket_WhenItsPullRequestOpens_ThenReadyForReviewAndLinked", async () => {
    const t = await ticketAt("in_progress");
    const result = await prs.apply(prEvent("opened"), project);
    expect(result).toMatchObject({ result: "linked", ticket: "AI-1", moves: ["ready_for_review"] });
    expect((await reload(t)).stage).toBe("ready_for_review");
    const events = await systemEvents(t);
    expect(events.map((e) => e.kind)).toEqual(["pr_linked", "stage_changed"]);
    expect(events[0]?.data).toMatchObject({ number: 70, state: "open" });
    expect(events[1]).toMatchObject({
      data: { forced: false },
      body: expect.stringContaining("#70"),
    });
  });

  it("GivenAReadyTicket_WhenItsPullRequestOpens_ThenItStepsThroughInProgress", async () => {
    const t = await ticketAt("ready");
    const result = await prs.apply(prEvent("opened"), project);
    expect(result.moves).toEqual(["in_progress", "ready_for_review"]);
    expect((await reload(t)).stage).toBe("ready_for_review");
  });

  it("GivenADraftPullRequest_WhenItOpens_ThenLinkedOnly", async () => {
    const t = await ticketAt("in_progress");
    expect(await prs.apply(prEvent("opened", { draft: true }), project)).toMatchObject({
      moves: [],
    });
    expect((await reload(t)).stage).toBe("in_progress");
  });

  it("GivenABacklogTicketWithoutTheDor_WhenItsPullRequestOpens_ThenReadyForReview", async () => {
    const t = await service.create(project.id, { type: "feature", title: "Bare" }, "andy");
    const result = await prs.apply(prEvent("opened"), project);
    expect(result.moves).toEqual(["ready", "in_progress", "ready_for_review"]);
    expect((await reload(t)).stage).toBe("ready_for_review");
  });

  it("GivenABacklogTicketWithOpenQuestions_WhenItsPullRequestMerges_ThenDoneAndQuestionsWithdrawn", async () => {
    const t = await ticketAt("backlog");
    await service.ask(project.id, t.id, { text: "Which?" }, "agent:r1");
    const result = await prs.apply(prEvent("closed", { state: "merged" }), project);
    expect(result.moves).toEqual([
      "ready",
      "in_progress",
      "ready_for_review",
      "monitoring",
      "done",
    ]);
    expect(await reload(t)).toMatchObject({ stage: "done", needsAttention: false });
    expect(await tracker.listQuestions({ ticketId: t.id, status: "open" })).toEqual([]);
    expect(await service.needsYou()).toEqual({ questions: [], tickets: [] });
  });

  it("GivenAFlagFromAnOldClose_WhenItsPullRequestMerges_ThenNeedsYouCleared", async () => {
    const t = await ticketAt("ready_for_review");
    await prs.apply(prEvent("closed", { number: 69, state: "closed" }), project);
    await prs.apply(prEvent("closed", { state: "merged" }), project);
    expect(await reload(t)).toMatchObject({ stage: "done", needsAttention: false });
  });

  it("GivenAnEpic_WhenItsPullRequestOpensMergesOrCloses_ThenLinkedOnly", async () => {
    const epic = await service.create(project.id, { type: "epic", title: "M1" }, "andy");
    await service.move(project.id, epic.id, "in_progress", "andy", { force: true });
    for (const e of [
      prEvent("opened"),
      prEvent("closed", { state: "merged" }),
      prEvent("closed", { state: "closed" }),
    ]) {
      expect(await prs.apply(e, project)).toMatchObject({ result: "linked", moves: [] });
    }
    expect(await reload(epic)).toMatchObject({ stage: "in_progress", needsAttention: false });
  });

  it("GivenAnInProgressTicket_WhenAPullRequestOpensIntoANonDefaultBranch_ThenLinkedOnly", async () => {
    const t = await ticketAt("in_progress");
    const opened = prEvent("opened", { baseRef: "feature", intoDefaultBranch: false });
    expect(await prs.apply(opened, project)).toMatchObject({ result: "linked", moves: [] });
    expect((await reload(t)).stage).toBe("in_progress");
  });

  it("GivenATicketAlreadyPastReview_WhenAnotherPullRequestOpens_ThenLinkedOnly", async () => {
    const t = await ticketAt("done");
    const result = await prs.apply(prEvent("opened"), project);
    expect(result.moves).toEqual([]);
    expect((await reload(t)).stage).toBe("done");
  });

  it("GivenACancelledTicket_WhenItsPullRequestOpensMergesOrCloses_ThenLinkedOnlyAndNotFlagged", async () => {
    const t = await service.create(project.id, readyStory, "andy");
    await service.cancel(project.id, t.id, "andy");
    for (const e of [
      prEvent("opened"),
      prEvent("closed", { state: "merged" }),
      prEvent("closed", { state: "closed" }),
    ]) {
      expect(await prs.apply(e, project)).toMatchObject({ result: "linked", moves: [] });
    }
    expect(await reload(t)).toMatchObject({ stage: "cancelled", needsAttention: false });
    expect(await service.needsYou()).toEqual({ questions: [], tickets: [] });
  });

  it("GivenAnArchivedDoneTicket_WhenAnotherPullRequestOpens_ThenItStaysArchivedAndDone", async () => {
    const t = await ticketAt("done");
    await service.archive(project.id, t.id, true, "andy");
    expect((await prs.apply(prEvent("opened"), project)).moves).toEqual([]);
    expect(await reload(t)).toMatchObject({ stage: "done", archived: true });
  });

  it("GivenATicketInReview_WhenItsPullRequestMerges_ThenDoneThroughMonitoring", async () => {
    const t = await ticketAt("ready_for_review");
    const result = await prs.apply(prEvent("closed", { state: "merged" }), project);
    expect(result).toMatchObject({ outcome: "merged", moves: ["monitoring", "done"] });
    expect((await reload(t)).stage).toBe("done");
    const linked = (await systemEvents(t)).find((e) => e.kind === "pr_linked");
    expect(linked?.data).toMatchObject({ state: "merged", url: expect.stringContaining("/70") });
  });

  it("GivenATicketInReview_WhenMergedIntoANonDefaultBranch_ThenLinkedOnly", async () => {
    const t = await ticketAt("ready_for_review");
    const merged = prEvent("closed", {
      state: "merged",
      baseRef: "feature",
      intoDefaultBranch: false,
    });
    expect(await prs.apply(merged, project)).toMatchObject({ result: "linked", moves: [] });
    expect((await reload(t)).stage).toBe("ready_for_review");
  });

  it("GivenAPullRequestClosedUnmerged_WhenReopened_ThenReadyForReviewAndNeedsYouCleared", async () => {
    const t = await ticketAt("ready_for_review");
    await prs.apply(prEvent("closed", { state: "closed" }), project);
    const result = await prs.apply(prEvent("reopened"), project);
    expect(result).toMatchObject({ moves: ["ready_for_review"], unflagged: true });
    expect(await reload(t)).toMatchObject({ stage: "ready_for_review", needsAttention: false });
  });

  it("GivenAnOpenQuestion_WhenTheClosedPullRequestIsReopened_ThenStillNeedsYou", async () => {
    const t = await ticketAt("ready_for_review");
    await prs.apply(prEvent("closed", { state: "closed" }), project);
    await service.ask(project.id, t.id, { text: "Which?" }, "agent:r1");
    expect(await prs.apply(prEvent("reopened"), project)).toMatchObject({ unflagged: false });
    expect((await reload(t)).needsAttention).toBe(true);
  });

  it("GivenAFlagFromSomethingElse_WhenAPullRequestOpens_ThenTheFlagStays", async () => {
    const t = await ticketAt("in_progress");
    await service.flag(project.id, t.id, "system");
    await prs.apply(prEvent("closed", { number: 69, state: "closed" }), project);
    const result = await prs.apply(prEvent("opened"), project);
    expect(result.unflagged).toBeUndefined();
    expect(await reload(t)).toMatchObject({ stage: "ready_for_review", needsAttention: true });
  });

  it("GivenATicketInReview_WhenItsPullRequestClosesUnmerged_ThenInProgressAndNeedsYou", async () => {
    const t = await ticketAt("ready_for_review");
    const result = await prs.apply(prEvent("closed", { state: "closed" }), project);
    expect(result).toMatchObject({ outcome: "closed", moves: ["in_progress"], flagged: true });
    expect(await reload(t)).toMatchObject({ stage: "in_progress", needsAttention: true });
  });

  it("GivenAnInProgressTicket_WhenADraftPullRequestCloses_ThenFlaggedWithoutAMove", async () => {
    const t = await ticketAt("in_progress");
    const result = await prs.apply(prEvent("closed", { state: "closed", draft: true }), project);
    expect(result).toMatchObject({ moves: [], flagged: true });
    expect(await reload(t)).toMatchObject({ stage: "in_progress", needsAttention: true });
  });

  it("GivenADoneTicket_WhenAnOldPullRequestCloses_ThenLinkedOnly", async () => {
    const t = await ticketAt("done");
    const result = await prs.apply(prEvent("closed", { state: "closed" }), project);
    expect(result).toMatchObject({ moves: [], flagged: false });
    expect(await reload(t)).toMatchObject({ stage: "done", needsAttention: false });
  });

  it("GivenNoKeyOrAnUnknownTicketOrANoOpAction_WhenApplied_ThenIgnoredAndNothingWritten", async () => {
    const t = await ticketAt("in_progress");
    expect(await prs.apply(prEvent("opened", { headRef: "fix/thing" }), project)).toEqual({
      result: "ignored",
      reason: "no_key",
    });
    expect(await prs.apply(prEvent("opened", { headRef: "AI-99" }), project)).toMatchObject({
      result: "ignored",
      reason: "no_ticket",
    });
    expect(await prs.apply(prEvent("synchronize"), project)).toMatchObject({ reason: "action" });
    expect(await prs.apply(prEvent("opened", { fromFork: true }), project)).toMatchObject({
      result: "ignored",
      reason: "fork",
    });
    expect(await systemEvents(t)).toEqual([]);
  });
});
