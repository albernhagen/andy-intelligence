import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { WorkTrackerError } from "@andy/contracts";
import { STAGES } from "@/lib/tickets";
import { readyStory, renderApp } from "@/test/harness";

/**
 * Board drag-and-drop (AI-16, AI-28), driven with dnd-kit's keyboard sensor: Space picks a card
 * up, arrows move it 25px a press, Space drops it. jsdom has no layout, so lanes get fake
 * 200px-wide rects side by side and the cards of a lane stack 60px apart.
 */
const COLUMN_WIDTH = 200;
const CARD_STEP = 60;

function fakeRect(el: Element): DOMRect {
  const lane = el.closest("[data-stage]");
  const i = lane ? STAGES.indexOf(lane.getAttribute("data-stage") as never) : -1;
  if (i < 0) return new DOMRect(0, 0, 0, 0);
  if (el.hasAttribute("data-stage")) return new DOMRect(i * COLUMN_WIDTH, 0, COLUMN_WIDTH, 1000);
  const cards = [...lane!.querySelectorAll("[data-ticket]")];
  const row = Math.max(0, cards.indexOf(el));
  return new DOMRect(i * COLUMN_WIDTH + 10, 40 + row * CARD_STEP, COLUMN_WIDTH - 20, 50);
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return fakeRect(this);
  });
});
afterEach(() => vi.restoreAllMocks());

/** Picks the card up, moves it `columns` to the right, and drops it. */
async function drag(
  user: ReturnType<typeof renderApp>["user"],
  key: string,
  columns: number,
  rows = 0,
) {
  const card = document.querySelector<HTMLElement>(`[data-ticket="${key}"]`)!;
  card.focus();
  await user.keyboard(" ");
  if (columns) await user.keyboard("{ArrowRight}".repeat((columns * COLUMN_WIDTH) / 25));
  const vertical = rows < 0 ? "{ArrowUp}" : "{ArrowDown}";
  if (rows) await user.keyboard(vertical.repeat(Math.round((Math.abs(rows) * CARD_STEP) / 25)));
  await user.keyboard(" ");
}

/** Done and Monitoring start as strips; this expands one and returns its lane. */
async function expand(user: ReturnType<typeof renderApp>["user"], name: string) {
  await user.click(screen.getByRole("button", { name: new RegExp(`^Show ${name}`) }));
  return screen.getByRole("region", { name });
}

async function boardWith(fields: Parameters<ReturnType<typeof renderApp>["service"]["create"]>[1]) {
  const harness = renderApp();
  await harness.tracker.createProject({ name: "AI", key: "AI" });
  const ticket = await harness.service.create("ai", fields, "andy");
  await harness.router.navigate({ to: "/p/ai" });
  const backlog = await screen.findByRole("region", { name: "Backlog" });
  await within(backlog).findByText(ticket.key);
  return { harness, ticket };
}

describe("board drag-and-drop", () => {
  it("GivenAReadyStoryInBacklog_WhenDraggedToReady_ThenItMovesWithoutForce", async () => {
    const { harness, ticket } = await boardWith(readyStory);

    await drag(harness.user, ticket.key, 1);

    const ready = screen.getByRole("region", { name: "Ready" });
    expect(await within(ready).findByText(ticket.key)).toBeTruthy();
    expect((await harness.service.history("ai", ticket.id)).at(-1)).toMatchObject({
      kind: "stage_changed",
      data: { from: "backlog", to: "ready", forced: false },
    });
  });

  it("GivenABacklogTicket_WhenDraggedToDone_ThenAForcedMoveWithNoReasonIsRecorded", async () => {
    const { harness, ticket } = await boardWith({ type: "chore", title: "Spike" });

    await drag(harness.user, ticket.key, 5);

    const done = await expand(harness.user, "Done");
    expect(await within(done).findByText(ticket.key)).toBeTruthy();
    expect((await harness.service.history("ai", ticket.id)).at(-1)).toMatchObject({
      kind: "stage_changed",
      body: null,
      data: { from: "backlog", to: "done", forced: true },
    });
  });

  it("GivenATicketMissingDoR_WhenDraggedToReady_ThenTheErrorShowsAndTheCardStaysInBacklog", async () => {
    const { harness, ticket } = await boardWith({ type: "feature", title: "Board" });

    await drag(harness.user, ticket.key, 1);

    expect((await screen.findByRole("alert")).textContent).toMatch(/Definition of Ready/);
    const backlog = screen.getByRole("region", { name: "Backlog" });
    expect(within(backlog).getByText(ticket.key)).toBeTruthy();
    await waitFor(async () =>
      expect((await harness.tracker.getTicket("ai", ticket.id))?.stage).toBe("backlog"),
    );
  });

  it("GivenTwoTicketsMissingDoR_WhenBothDroppedOnReadyInARow_ThenEachCardShowsItsError", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const first = await harness.service.create("ai", { type: "feature", title: "One" }, "andy");
    const second = await harness.service.create("ai", { type: "feature", title: "Two" }, "andy");
    await harness.router.navigate({ to: "/p/ai" });
    const backlog = await screen.findByRole("region", { name: "Backlog" });
    await within(backlog).findByText(second.key);

    await drag(harness.user, first.key, 1);
    await drag(harness.user, second.key, 1);

    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(within(backlog).getByText(first.key)).toBeTruthy();
    expect(within(backlog).getByText(second.key)).toBeTruthy();
  });
});

/**
 * AI-25: Dropping a card on the board opens the ticket. A real mouse drag ends with a click on
 * the card's link. Once a drag starts, dnd-kit stops that click's propagation at the document, so
 * React never sees it; only cancelling its default keeps the browser from following the href.
 * fireEvent.click returns false when the click's default was prevented.
 */
async function mouseDrag(key: string, columns: number, { click = true } = {}) {
  const card = document.querySelector<HTMLElement>(`[data-ticket="${key}"]`)!;
  const y = 65;
  fireEvent.mouseDown(card, { button: 0, clientX: 100, clientY: y });
  fireEvent.mouseMove(document, { clientX: 110, clientY: y });
  fireEvent.mouseMove(document, { clientX: 100 + columns * COLUMN_WIDTH, clientY: y });
  fireEvent.mouseUp(document, { button: 0, clientX: 100 + columns * COLUMN_WIDTH, clientY: y });
  // The drop shows at once, so the card is now in its new lane: the click lands there.
  const dropped = document.querySelector<HTMLElement>(`[data-ticket="${key}"]`)!;
  return click ? fireEvent.click(dropped, { button: 0, detail: 1 }) : true;
}

/** dnd-kit keeps swallowing clicks for 50 ms after a drop; no person clicks again that fast. */
const dndKitClickWindow = () => new Promise((resolve) => setTimeout(resolve, 60));

describe("board drop keeps the board in view (AI-25)", () => {
  it("GivenABacklogTicket_WhenMouseDroppedOnReadyForReview_ThenItMovesAndTheLinkIsNotFollowed", async () => {
    const { harness, ticket } = await boardWith({ type: "chore", title: "Spike" });

    const followed = await mouseDrag(ticket.key, 3);

    expect(followed).toBe(false);
    const lane = screen.getByRole("region", { name: "Ready for review" });
    expect(await within(lane).findByText(ticket.key)).toBeTruthy();
    expect(harness.router.state.location.pathname).toBe("/p/ai");
  });

  it("GivenACardWasJustDropped_WhenItIsClicked_ThenTheTicketOpens", async () => {
    const { harness, ticket } = await boardWith({ type: "chore", title: "Spike" });
    await mouseDrag(ticket.key, 3);
    const lane = screen.getByRole("region", { name: "Ready for review" });
    await within(lane).findByText(ticket.key);
    await dndKitClickWindow();

    await harness.user.click(within(lane).getByText(ticket.key));

    await waitFor(() =>
      expect(harness.router.state.location.pathname).toBe(`/p/ai/t/${ticket.key}`),
    );
  });

  it("GivenADropWithNoTrailingClick_WhenEnterIsPressedOnTheCard_ThenTheTicketOpens", async () => {
    const { harness, ticket } = await boardWith({ type: "chore", title: "Spike" });
    // Like a touch drop: no click follows it, so the suppression is still armed.
    await mouseDrag(ticket.key, 3, { click: false });
    const lane = screen.getByRole("region", { name: "Ready for review" });
    await within(lane).findByText(ticket.key);
    await dndKitClickWindow();

    document.querySelector<HTMLElement>(`[data-ticket="${ticket.key}"]`)!.focus();
    await harness.user.keyboard("{Enter}");

    await waitFor(() =>
      expect(harness.router.state.location.pathname).toBe(`/p/ai/t/${ticket.key}`),
    );
  });

  it("GivenABacklogTicket_WhenKeyboardDroppedOnDone_ThenTheBoardStaysInView", async () => {
    const { harness, ticket } = await boardWith({ type: "chore", title: "Spike" });

    await drag(harness.user, ticket.key, 5);

    const done = await expand(harness.user, "Done");
    expect(await within(done).findByText(ticket.key)).toBeTruthy();
    expect(harness.router.state.location.pathname).toBe("/p/ai");
  });
});

/** AI-28: Board v2: status on cards, ordered Ready lane, reorder within a lane, quick add. */
describe("board v2", () => {
  async function openBoard(harness: ReturnType<typeof renderApp>, waitFor = "AI-1") {
    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByText(waitFor);
  }

  const card = (key: string) => document.querySelector<HTMLElement>(`[data-ticket="${key}"]`)!;
  const titlesIn = (lane: string) =>
    [...screen.getByRole("region", { name: lane }).querySelectorAll("[data-ticket]")].map((c) =>
      c.getAttribute("data-ticket"),
    );

  async function project() {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    return harness;
  }

  it("GivenARunInFlight_WhenTheBoardLoads_ThenTheCardShowsItsStepAndElapsedTime", async () => {
    const harness = await project();
    const t = await harness.service.create("ai", { title: "Refine me" }, "andy");
    const route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;
    const run = await harness.runs.create({
      projectId: "ai",
      ticketId: t.id,
      step: "refine",
      route,
      tier: null,
    });
    const startedAt = new Date(Date.now() - 12 * 60_000 - 5_000).toISOString();
    await harness.runs.update(run.id, { status: "running", startedAt }, ["queued"]);

    await openBoard(harness);

    expect(within(card("AI-1")).getByText("Refining · 12 min")).toBeTruthy();
  });

  it("GivenOpenQuestions_WhenTheBoardLoads_ThenTheCardShowsTheirCount", async () => {
    const harness = await project();
    const t = await harness.service.create("ai", { title: "Unclear" }, "andy");
    await harness.service.ask("ai", t.id, { text: "Which lane?" }, "andy");
    await harness.service.ask("ai", t.id, { text: "Which colour?" }, "andy");

    await openBoard(harness);

    expect(within(card("AI-1")).getByText("2 questions")).toBeTruthy();
  });

  it("GivenALinkedPrAndAnOpenBlocker_WhenTheBoardLoads_ThenTheCardShowsBoth", async () => {
    const harness = await project();
    const blocker = await harness.service.create("ai", { title: "First" }, "andy");
    const t = await harness.service.create(
      "ai",
      { title: "Second", blockedBy: [blocker.id] },
      "andy",
    );
    await harness.tracker.updateTicket(
      "ai",
      t.id,
      { stage: { to: "in_progress", reason: null } },
      "andy",
    );
    await harness.tracker.linkPullRequest(
      "ai",
      t.id,
      { number: 61, url: "https://github.com/a/b/pull/61", state: "open" },
      "system",
    );

    await openBoard(harness, "AI-2");

    expect(within(card("AI-2")).getByText("PR #61 · open")).toBeTruthy();
    expect(within(card("AI-2")).getByText("Blocked by AI-1")).toBeTruthy();
  });

  it("GivenThreeCardsInALane_WhenTheLastIsDraggedToTheTop_ThenTheOrderIsStoredAndShown", async () => {
    const harness = await project();
    for (const title of ["A", "B", "C"]) await harness.service.create("ai", { title }, "andy");
    await openBoard(harness, "AI-3");

    await drag(harness.user, "AI-3", 0, -2);

    await waitFor(() => expect(titlesIn("Backlog")).toEqual(["AI-3", "AI-1", "AI-2"]));
    // A reload reads the stored order.
    const stored = await harness.tracker.listTickets("ai");
    expect(stored.map((t) => t.key)).toEqual(["AI-3", "AI-1", "AI-2"]);
  });

  it("GivenAReorderTheApiRefuses_WhenDropped_ThenTheCardGoesBackAndShowsWhy", async () => {
    const harness = await project();
    for (const title of ["A", "B"]) await harness.service.create("ai", { title }, "andy");
    await openBoard(harness, "AI-2");
    harness.tracker.updateTicket = async () => {
      throw new WorkTrackerError("conflict", "ticket AI-2 changed since it was read");
    };

    await drag(harness.user, "AI-2", 0, -1);

    expect((await within(card("AI-2").parentElement!).findByRole("alert")).textContent).toMatch(
      /changed since it was read/,
    );
    expect(titlesIn("Backlog")).toEqual(["AI-1", "AI-2"]);
  });

  it("GivenReadyTickets_WhenTheBoardLoads_ThenTheyAreNumberedAndTheFirstUnblockedIsNext", async () => {
    const harness = await project();
    const blocker = await harness.service.create("ai", { title: "Blocker" }, "andy");
    for (const [title, blockedBy] of [
      ["Blocked", [blocker.id]],
      ["Free", []],
      ["Later", []],
    ] as const) {
      const t = await harness.service.create(
        "ai",
        { ...readyStory, title, blockedBy: [...blockedBy] },
        "andy",
      );
      await harness.service.move("ai", t.id, "ready", "andy");
    }

    await openBoard(harness, "AI-4");

    const ready = screen.getByRole("region", { name: "Ready" });
    expect(
      within(ready)
        .getAllByLabelText(/^Position/)
        .map((p) => p.textContent),
    ).toEqual(["1", "2", "3"]);
    expect(within(card("AI-3")).getByText("Next")).toBeTruthy();
    expect(within(ready).getAllByText("Next")).toHaveLength(1);
  });

  it("GivenATitle_WhenTypedInQuickAddAndEnterPressed_ThenItIsInBacklogAndTheBoardStays", async () => {
    const harness = await project();
    await harness.router.navigate({ to: "/p/ai" });

    await harness.user.type(await screen.findByLabelText("Add a ticket"), "Quick one{Enter}");

    const backlog = screen.getByRole("region", { name: "Backlog" });
    expect(await within(backlog).findByText("Quick one")).toBeTruthy();
    expect((await harness.tracker.listTickets("ai"))[0]).toMatchObject({
      title: "Quick one",
      type: null,
    });
    expect(harness.router.state.location.pathname).toBe("/p/ai");
    expect((screen.getByLabelText("Add a ticket") as HTMLInputElement).value).toBe("");
  });

  it("GivenAnEmptyTitle_WhenEnterIsPressed_ThenNothingIsCreated", async () => {
    const harness = await project();
    await harness.router.navigate({ to: "/p/ai" });

    await harness.user.type(await screen.findByLabelText("Add a ticket"), "   {Enter}");

    expect(await harness.tracker.listTickets("ai")).toHaveLength(0);
  });

  it("GivenDoneTickets_WhenTheBoardLoads_ThenDoneIsAStripWithACountUntilClicked", async () => {
    const harness = await project();
    const t = await harness.service.create("ai", { title: "Shipped" }, "andy");
    await harness.service.move("ai", t.id, "done", "andy", { force: true });
    await harness.router.navigate({ to: "/p/ai" });

    const strip = await screen.findByRole("button", { name: "Show Done, 1" });
    expect(screen.queryByText("Shipped")).toBeNull();
    await harness.user.click(strip);
    expect(within(screen.getByRole("region", { name: "Done" })).getByText("Shipped")).toBeTruthy();
    await harness.user.click(screen.getByRole("button", { name: "Collapse Done" }));
    expect(screen.queryByText("Shipped")).toBeNull();
  });

  it("GivenACancelledTicket_WhenTheToggleIsOff_ThenTheCancelledLaneIsHidden", async () => {
    const harness = await project();
    const t = await harness.service.create("ai", { title: "Dropped" }, "andy");
    await harness.service.cancel("ai", t.id, "andy");
    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByRole("region", { name: "Backlog" });

    expect(screen.queryByRole("region", { name: "Cancelled" })).toBeNull();
    await harness.user.click(screen.getByLabelText("Show cancelled and archived"));
    const cancelled = screen.getByRole("region", { name: "Cancelled" });
    expect(within(cancelled).getByText("Dropped")).toBeTruthy();
  });
});
