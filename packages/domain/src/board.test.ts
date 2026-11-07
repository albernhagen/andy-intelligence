import { InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { BoardReader, MAX_PR_LOOKUPS } from "./board";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;

describe("BoardReader", () => {
  let tracker: InMemoryWorkTracker;
  let runs: InMemoryRunStore;
  let board: BoardReader;

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker(() => NOW);
    runs = new InMemoryRunStore(() => NOW);
    board = new BoardReader(tracker, runs);
    await tracker.createProject({ name: "AI", key: "AI" });
  });

  const newRun = (ticketId: string) =>
    runs.create({ projectId: "ai", ticketId, step: "refine", route, tier: null });

  it("GivenATicketWithNothingGoingOn_WhenRead_ThenItsSummaryIsEmpty", async () => {
    await tracker.createTicket("ai", { title: "Quiet" }, "andy");

    expect((await board.tickets("ai"))[0]?.summary).toEqual({
      openQuestions: 0,
      run: null,
      pullRequest: null,
    });
  });

  it("GivenOpenAndAnsweredQuestions_WhenRead_ThenOnlyOpenOnesAreCounted", async () => {
    const t = await tracker.createTicket("ai", { title: "Asks" }, "andy");
    await tracker.askQuestion("ai", t.id, { text: "One?" }, "andy");
    await tracker.askQuestion("ai", t.id, { text: "Two?" }, "andy");
    const answered = await tracker.askQuestion("ai", t.id, { text: "Three?" }, "andy");
    await tracker.answerQuestion(answered.id, "yes", "ui", "andy");

    expect((await board.tickets("ai"))[0]?.summary.openQuestions).toBe(2);
  });

  it("GivenARunInFlightAndAFinishedOne_WhenRead_ThenTheCardShowsTheOneInFlight", async () => {
    const t = await tracker.createTicket("ai", { title: "Runs" }, "andy");
    const done = await newRun(t.id);
    await runs.update(done.id, { status: "failed", endedAt: NOW.toISOString() }, ["queued"]);
    const live = await newRun(t.id);
    await runs.update(live.id, { status: "running", startedAt: NOW.toISOString() }, ["queued"]);

    expect((await board.tickets("ai"))[0]?.summary.run).toEqual({
      id: live.id,
      step: "refine",
      status: "running",
      startedAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
    });
  });

  it("GivenTwoLinkedPrs_WhenTheTicketIsInReview_ThenTheCardShowsTheLatest", async () => {
    const t = await tracker.createTicket("ai", { title: "PR" }, "andy");
    await tracker.updateTicket(
      "ai",
      t.id,
      { stage: { to: "ready_for_review", reason: null } },
      "andy",
    );
    const url = "https://github.com/a/b/pull/";
    await tracker.linkPullRequest(
      "ai",
      t.id,
      { number: 1, url: `${url}1`, state: "closed" },
      "system",
    );
    await tracker.linkPullRequest(
      "ai",
      t.id,
      { number: 2, url: `${url}2`, state: "open" },
      "system",
    );

    expect((await board.tickets("ai"))[0]?.summary.pullRequest).toEqual({
      number: 2,
      url: `${url}2`,
      state: "open",
    });
  });

  it("GivenALinkedPrOnABacklogTicket_WhenRead_ThenTheHistoryIsNotRead", async () => {
    const t = await tracker.createTicket("ai", { title: "PR" }, "andy");
    await tracker.linkPullRequest(
      "ai",
      t.id,
      { number: 1, url: "https://github.com/a/b/pull/1", state: "open" },
      "system",
    );

    expect((await board.tickets("ai"))[0]?.summary.pullRequest).toBeNull();
  });

  it("GivenMoreCardsInFlightThanTheCap_WhenRead_ThenHistoryReadsStopAtTheCap", async () => {
    for (let i = 0; i < MAX_PR_LOOKUPS + 2; i++) {
      const t = await tracker.createTicket("ai", { title: `T${i}` }, "andy");
      await tracker.updateTicket(
        "ai",
        t.id,
        { stage: { to: "in_progress", reason: null } },
        "andy",
      );
    }
    let reads = 0;
    const listEvents = tracker.listEvents.bind(tracker);
    tracker.listEvents = (p, t) => (reads++, listEvents(p, t));

    expect(await board.tickets("ai")).toHaveLength(MAX_PR_LOOKUPS + 2);
    expect(reads).toBe(MAX_PR_LOOKUPS);
  });

  it("GivenAnUnknownProject_WhenRead_ThenNotFound", async () => {
    await expect(board.tickets("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});
