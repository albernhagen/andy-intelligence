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
  type: "story",
  title: "Board",
  body: "Andy can't see tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  size: "S",
  sizeReason: "one screen",
  tier: "strong",
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

  it("GivenADraftOrABacklogTicket_WhenThePullRequestOpens_ThenLinkedOnly", async () => {
    const draftTicket = await ticketAt("in_progress");
    await prs.apply(prEvent("opened", { draft: true }), project);
    expect((await reload(draftTicket)).stage).toBe("in_progress");

    const backlog = await service.create(project.id, readyStory, "andy");
    const result = await prs.apply(prEvent("opened", { headRef: "AI-2" }), project);
    expect(result).toMatchObject({ result: "linked", moves: [] });
    expect((await reload(backlog)).stage).toBe("backlog");
    expect((await systemEvents(backlog)).map((e) => e.kind)).toEqual(["pr_linked"]);
  });

  it("GivenATicketAlreadyPastReview_WhenAnotherPullRequestOpens_ThenLinkedOnly", async () => {
    const t = await ticketAt("done");
    const result = await prs.apply(prEvent("opened"), project);
    expect(result.moves).toEqual([]);
    expect((await reload(t)).stage).toBe("done");
  });

  it("GivenATicketInReview_WhenItsPullRequestMerges_ThenDoneThroughMonitoring", async () => {
    const t = await ticketAt("ready_for_review");
    const result = await prs.apply(prEvent("closed", { state: "merged" }), project);
    expect(result).toMatchObject({ outcome: "merged", moves: ["monitoring", "done"] });
    expect((await reload(t)).stage).toBe("done");
    const linked = (await systemEvents(t)).find((e) => e.kind === "pr_linked");
    expect(linked?.data).toMatchObject({ state: "merged", url: expect.stringContaining("/70") });
  });

  it("GivenATicketInReview_WhenItsPullRequestClosesUnmerged_ThenInProgressAndNeedsYou", async () => {
    const t = await ticketAt("ready_for_review");
    const result = await prs.apply(prEvent("closed", { state: "closed" }), project);
    expect(result).toMatchObject({ outcome: "closed", moves: ["in_progress"], flagged: true });
    expect(await reload(t)).toMatchObject({ stage: "in_progress", needsYou: true });
  });

  it("GivenAnInProgressTicket_WhenADraftPullRequestCloses_ThenFlaggedWithoutAMove", async () => {
    const t = await ticketAt("in_progress");
    const result = await prs.apply(prEvent("closed", { state: "closed", draft: true }), project);
    expect(result).toMatchObject({ moves: [], flagged: true });
    expect(await reload(t)).toMatchObject({ stage: "in_progress", needsYou: true });
  });

  it("GivenADoneTicket_WhenAnOldPullRequestCloses_ThenLinkedOnly", async () => {
    const t = await ticketAt("done");
    const result = await prs.apply(prEvent("closed", { state: "closed" }), project);
    expect(result).toMatchObject({ moves: [], flagged: false });
    expect(await reload(t)).toMatchObject({ stage: "done", needsYou: false });
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
