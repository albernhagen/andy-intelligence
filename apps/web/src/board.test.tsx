import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { WorkTrackerError } from "@andy/contracts";
import { STAGES } from "@/lib/tickets";
import { DROP_ANIMATION } from "@/components/DragPreview";
import { dragCopySource } from "@/test/drag-layout";
import { readyStory, renderApp } from "@/test/harness";
import { pick } from "@/test/pick";

/**
 * Board drag-and-drop (AI-16, AI-28), driven with dnd-kit's keyboard sensor: Space picks a card
 * up, arrows move it 25px a press, Space drops it. jsdom has no layout, so lanes get fake
 * 200px-wide rects side by side and the cards of a lane stack 60px apart.
 */
const COLUMN_WIDTH = 200;
const CARD_STEP = 60;

/** The lanes a project that doesn't deploy shows: no Verifying lane (AI-181). */
const LANES = STAGES.filter((s) => s !== "verifying");

function fakeRect(el: Element): DOMRect {
  const source = dragCopySource(el);
  if (source) return fakeRect(source);
  const lane = el.closest("[data-stage]");
  const i = lane ? LANES.indexOf(lane.getAttribute("data-stage") as never) : -1;
  if (i < 0) return new DOMRect(0, 0, 0, 0);
  if (el.hasAttribute("data-stage")) return new DOMRect(i * COLUMN_WIDTH, 0, COLUMN_WIDTH, 1000);
  const cards = [...lane!.querySelectorAll("[data-ticket]")];
  const row = Math.max(0, cards.indexOf(el));
  return new DOMRect(i * COLUMN_WIDTH + 10, 40 + row * CARD_STEP, COLUMN_WIDTH - 20, 50);
}

beforeAll(() => {
  // jsdom lacks the pointer-capture and scroll APIs Radix Select calls (the epic filter, AI-374).
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

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
  const across = columns < 0 ? "{ArrowLeft}" : "{ArrowRight}";
  if (columns) await user.keyboard(across.repeat((Math.abs(columns) * COLUMN_WIDTH) / 25));
  const vertical = rows < 0 ? "{ArrowUp}" : "{ArrowDown}";
  if (rows) await user.keyboard(vertical.repeat(Math.round((Math.abs(rows) * CARD_STEP) / 25)));
  await user.keyboard(" ");
}

/** Done starts as a strip; this expands it and returns its lane. */
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
  it("GivenReadySortedByScore_WhenACardIsDraggedWithinIt_ThenNoRankChanges", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    for (const size of ["L", "S"] as const) {
      const t = await harness.service.create("ai", { ...readyStory, size }, "andy");
      await harness.service.move("ai", t.id, "ready", "andy");
    }
    await harness.router.navigate({
      to: "/p/$projectId",
      params: { projectId: "ai" },
      search: { sort: "score" },
    });
    await screen.findByText("AI-2");
    const before = (await harness.tracker.listTickets("ai", { stage: "ready" })).map((t) => t.rank);

    await drag(harness.user, "AI-2", 0, 1);

    const after = await harness.tracker.listTickets("ai", { stage: "ready" });
    expect(after.map((t) => t.rank)).toEqual(before);
    expect(after.map((t) => t.key)).toEqual(["AI-1", "AI-2"]);
  });

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

    await drag(harness.user, ticket.key, 4);

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

    await drag(harness.user, ticket.key, 4);

    const done = await expand(harness.user, "Done");
    expect(await within(done).findByText(ticket.key)).toBeTruthy();
    expect(harness.router.state.location.pathname).toBe("/p/ai");
  });
});

/** AI-396: the dragged card stays visible under the pointer. */
describe("board drag preview", () => {
  const overlay = () => document.querySelector<HTMLElement>("[data-drag-overlay]");

  async function pickUp(user: ReturnType<typeof renderApp>["user"], key: string) {
    document.querySelector<HTMLElement>(`[data-ticket="${key}"]`)!.focus();
    await user.keyboard(" ");
  }

  it("GivenABacklogCard_WhenItIsPickedUp_ThenACopyOfItShowsUnderThePointer", async () => {
    const { harness, ticket } = await boardWith({ type: "chore", title: "Spike" });

    await pickUp(harness.user, ticket.key);

    const copy = await waitFor(() => {
      expect(overlay()).not.toBeNull();
      return overlay()!;
    });
    expect(copy.textContent).toContain(ticket.key);
    expect(copy.textContent).toContain("Spike");
    // A picture of the card, not a second link or card for the drag code and screen readers.
    expect(copy.getAttribute("aria-hidden")).toBe("true");
    expect(copy.querySelector("a, [data-ticket]")).toBeNull();
  });

  it("GivenACardIsDragged_WhenItIsOverAnotherLane_ThenItsSlotIsAPlaceholderAndThatLaneIsHighlighted", async () => {
    const { harness, ticket } = await boardWith({ type: "chore", title: "Spike" });

    await pickUp(harness.user, ticket.key);
    await harness.user.keyboard("{ArrowRight}".repeat(COLUMN_WIDTH / 25));

    const backlog = screen.getByRole("region", { name: "Backlog" });
    const placeholder = backlog.querySelector(`[data-ticket="${ticket.key}"]`)!;
    expect(placeholder.hasAttribute("data-dragging")).toBe(true);
    expect(placeholder.className).toContain("border-dashed");
    const ready = screen.getByRole("region", { name: "Ready" });
    await waitFor(() => expect(ready.hasAttribute("data-drop-over")).toBe(true));
    expect(ready.className).toContain("bg-selected");
    expect(backlog.hasAttribute("data-drop-over")).toBe(false);
  });

  it("GivenACardIsDragged_WhenItIsDroppedOrTheDragIsCancelled_ThenTheCopyIsGoneWithin200ms", async () => {
    const { harness, ticket } = await boardWith({ type: "chore", title: "Spike" });

    await pickUp(harness.user, ticket.key);
    await waitFor(() => expect(overlay()).not.toBeNull());
    await harness.user.keyboard("{Escape}");
    await waitFor(() => expect(overlay()).toBeNull(), { timeout: 200 });
    expect(document.querySelector("[data-dragging]")).toBeNull();

    await pickUp(harness.user, ticket.key);
    await waitFor(() => expect(overlay()).not.toBeNull());
    await harness.user.keyboard("{ArrowRight}".repeat(COLUMN_WIDTH / 25) + " ");
    await waitFor(() => expect(overlay()).toBeNull(), { timeout: 200 });
    expect(document.querySelector("[data-drop-over]")).toBeNull();
    // Where a browser animates the drop, the settle is shorter than that limit.
    expect(DROP_ANIMATION.duration).toBeLessThanOrEqual(200);
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
    for (const title of ["A", "B", "C"]) {
      await harness.service.create("ai", { title }, "andy", { upNext: true });
    }
    await openBoard(harness, "AI-3");

    await drag(harness.user, "AI-3", 0, -2);

    await waitFor(() => expect(titlesIn("Backlog")).toEqual(["AI-3", "AI-1", "AI-2"]));
    // A reload reads the stored order.
    await waitFor(async () => {
      const stored = (await harness.tracker.listTickets("ai")).sort((a, b) =>
        a.upNextRank! < b.upNextRank! ? -1 : 1,
      );
      expect(stored.map((t) => t.key)).toEqual(["AI-3", "AI-1", "AI-2"]);
    });
  });

  it("GivenAnInProgressCard_WhenDroppedOnUpNext_ThenItLandsInIdeasWithNoUpNextRank", async () => {
    const harness = await project();
    await harness.service.create("ai", { title: "Queued" }, "andy", { upNext: true });
    const stale = await harness.service.create("ai", { title: "Stale" }, "andy");
    await harness.tracker.updateTicket(
      "ai",
      stale.id,
      { stage: { to: "in_progress", reason: null } },
      "andy",
    );
    await openBoard(harness, "AI-2");

    // In progress is two columns right of Backlog; row 0 lands on Up next's first card.
    await drag(harness.user, "AI-2", -2);

    await waitFor(async () =>
      expect(await harness.tracker.getTicket("ai", stale.id)).toMatchObject({
        stage: "backlog",
        upNextRank: null,
      }),
    );
  });

  it("GivenAnIdea_WhenMovedToUpNext_ThenTheBoardSplitsAndItEntersUpNext", async () => {
    const harness = await project();
    await harness.service.create("ai", { title: "A" }, "andy");
    await openBoard(harness, "AI-1");
    expect(screen.getByText("Ideas")).toBeTruthy();

    await harness.router.navigate({ to: "/p/ai/t/AI-1" });
    await harness.user.click(await screen.findByRole("button", { name: "Move…" }));
    await harness.user.click(screen.getByRole("button", { name: "Move to Up next" }));

    await waitFor(async () =>
      expect((await harness.tracker.listTickets("ai"))[0]?.upNextRank).not.toBeNull(),
    );
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

  it("GivenTheBoard_WhenItRenders_ThenThereIsNoMonitoringLaneOrStrip", async () => {
    const harness = await project();
    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByRole("region", { name: "Ready for review" });
    expect(screen.queryByRole("region", { name: "Monitoring" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Monitoring/ })).toBeNull();
    expect(screen.queryByText("Monitoring")).toBeNull();
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

/** AI-86: M4.2: Board: group by epic. */
describe("board grouped by epic", () => {
  /**
   * AI-1 is an epic in Backlog; AI-2 and AI-4 are its children in Ready, AI-3 (Ready) has no
   * epic, AI-5 is a Done child. Grouped, Ready reads: AI-1's header, AI-2, AI-4, No epic, AI-3.
   */
  async function seeded() {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const epic = await harness.service.create(
      "ai",
      { type: "epic", title: "Epics on the board" },
      "andy",
    );
    for (const [title, parentId] of [
      ["A", epic.id],
      ["B", null],
      ["C", epic.id],
    ] as const) {
      const t = await harness.service.create("ai", { ...readyStory, title, parentId }, "andy");
      await harness.service.move("ai", t.id, "ready", "andy");
    }
    const done = await harness.service.create("ai", { title: "D", parentId: epic.id }, "andy");
    await harness.service.move("ai", done.id, "done", "andy", { force: true });
    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByText("AI-4");
    return harness;
  }

  /** Headers (`epic:<key>`) and cards in the order a lane shows them. */
  const rowsIn = (lane: string) =>
    [
      ...screen.getByRole("region", { name: lane }).querySelectorAll("[data-epic], [data-ticket]"),
    ].map((el) =>
      el.hasAttribute("data-epic")
        ? `epic:${el.getAttribute("data-epic")}`
        : el.getAttribute("data-ticket"),
    );
  const groupToggle = () => screen.getByRole("switch", { name: "Group by epic" });
  const pickEpic = async (user: { click: (el: Element) => Promise<void> }, name: string) => {
    await user.click(screen.getByRole("combobox", { name: "Epic" }));
    await user.click(await screen.findByRole("option", { name }));
  };

  it("GivenGroupByEpicOn_WhenTheBoardShows_ThenEachLaneHasAHeaderPerEpicAndNoEpicLast", async () => {
    const harness = await seeded();
    expect(rowsIn("Ready")).toEqual(["AI-2", "AI-3", "AI-4"]);

    await harness.user.click(groupToggle());

    // The epic has no card (AI-403); Ideas has its own groups (AI-400), grouped or not.
    expect(rowsIn("Backlog")).toEqual([]);
    expect(rowsIn("Ready")).toEqual(["epic:AI-1", "AI-2", "AI-4", "epic:none", "AI-3"]);
    const header = document.querySelector('[data-epic="AI-1"]')!;
    expect(header.textContent).toContain("Epics on the board");
    expect(header.textContent).toContain("1 of 3 done");
  });

  it("GivenAnEpicPickedInTheFilter_WhenTheBoardShows_ThenOnlyItsChildrenShow", async () => {
    const harness = await seeded();

    await pickEpic(harness.user, "AI-1: Epics on the board");

    expect(rowsIn("Ready")).toEqual(["AI-2", "AI-4"]);
    expect(rowsIn("Backlog")).toEqual([]);
    expect(screen.getByRole("button", { name: "Show Done, 1" })).toBeTruthy();
    await pickEpic(harness.user, "All tickets");
    expect(rowsIn("Ready")).toEqual(["AI-2", "AI-3", "AI-4"]);
  });

  it("GivenAGroupedLane_WhenACardIsDraggedWithinItsGroup_ThenItsLaneRankIsStored", async () => {
    const harness = await seeded();
    await harness.user.click(groupToggle());

    await drag(harness.user, "AI-4", 0, -1);

    await waitFor(() =>
      expect(rowsIn("Ready")).toEqual(["epic:AI-1", "AI-4", "AI-2", "epic:none", "AI-3"]),
    );
    const stored = (await harness.tracker.listTickets("ai", { stage: "ready" })).sort((a, b) =>
      a.rank < b.rank ? -1 : 1,
    );
    expect(stored.map((t) => t.key)).toEqual(["AI-4", "AI-2", "AI-3"]);
  });

  it("GivenAGroupedLane_WhenTheApiRefusesTheReorder_ThenTheCardGoesBackAndShowsWhy", async () => {
    const harness = await seeded();
    await harness.user.click(groupToggle());
    harness.tracker.updateTicket = async () => {
      throw new WorkTrackerError("conflict", "ticket AI-4 changed since it was read");
    };

    await drag(harness.user, "AI-4", 0, -1);

    const alert = await within(
      document.querySelector('[data-ticket="AI-4"]')!.parentElement!,
    ).findByRole("alert");
    expect(alert.textContent).toMatch(/changed since it was read/);
    expect(rowsIn("Ready")).toEqual(["epic:AI-1", "AI-2", "AI-4", "epic:none", "AI-3"]);
  });

  it("GivenAGroupedLane_WhenACardIsDroppedOnAnotherEpicsCard_ThenNothingChanges", async () => {
    const harness = await seeded();
    await harness.user.click(groupToggle());
    const before = (await harness.tracker.listTickets("ai")).map((t) => t.rank);

    await drag(harness.user, "AI-3", 0, -1);

    expect((await harness.tracker.listTickets("ai")).map((t) => t.rank)).toEqual(before);
    expect(rowsIn("Ready")).toEqual(["epic:AI-1", "AI-2", "AI-4", "epic:none", "AI-3"]);
  });

  it("GivenGroupByEpicTurnedOn_WhenTheBoardIsOpenedAgain_ThenItIsStillGrouped", async () => {
    const harness = await seeded();
    await harness.user.click(groupToggle());
    expect(window.localStorage.getItem("andy.board.groupByEpic")).toBe("1");

    await harness.router.navigate({ to: "/p/ai/inbox" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Backlog" })).toBeNull());
    await harness.router.navigate({ to: "/p/ai" });

    await screen.findByText("AI-4");
    expect(groupToggle().getAttribute("aria-checked")).toBe("true");
    expect(rowsIn("Ready")[0]).toBe("epic:AI-1");
  });

  it("GivenTheChoiceStoredBeforeLoad_WhenTheBoardLoads_ThenItStartsGrouped", async () => {
    window.localStorage.setItem("andy.board.groupByEpic", "1");
    await seeded();

    expect(groupToggle().getAttribute("aria-checked")).toBe("true");
    expect(rowsIn("Ready")).toContain("epic:none");
  });
});

describe("Verifying lane (AI-181)", () => {
  it("GivenAProjectThatDoesNotDeploy_WhenTheBoardOpens_ThenNoVerifyingLane", async () => {
    await boardWith({ type: "chore", title: "Spike" });

    expect(screen.queryByRole("region", { name: "Verifying" })).toBeNull();
  });

  it("GivenAProjectThatDeploys_WhenTheBoardOpens_ThenTheVerifyingLaneShowsWithItsTicket", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    await harness.tracker.updateProject("ai", { deployKind: "cloud-run" });
    const t = await harness.service.create("ai", { type: "chore", title: "Ship" }, "andy");
    await harness.service.move("ai", t.id, "ready_for_review", "andy", { force: true });
    await harness.service.move("ai", t.id, "verifying", "andy");
    await harness.router.navigate({ to: "/p/ai" });

    const lane = await screen.findByRole("region", { name: "Verifying" });
    expect(await within(lane).findByText(t.key)).toBeTruthy();
  });
});

/** AI-400: Board: Ideas grouped by milestone and epic, parked groups collapsed, and a filter box. */
describe("Ideas grouped by milestone and epic, and the filter box", () => {
  const AT = "2026-11-26T12:00:00.000Z";

  /**
   * M4 (approved) holds AI-1 "Board polish", whose child AI-3 "Group ideas" is an idea; M6
   * (parked) holds AI-2 "Releases", whose child AI-4 "Promote" is an idea. AI-5 "Loose idea" has
   * no epic. AI-6 "Ready polish" is a child of AI-1 in Ready.
   */
  async function seeded(extra?: (h: ReturnType<typeof renderApp>) => Promise<void>) {
    const harness = renderApp();
    const { tracker, milestones, service } = harness;
    await tracker.createProject({ name: "AI", key: "AI" });
    for (const [id, order, name, status] of [
      ["m4", 4, "M4: Epics", "approved"],
      ["m6", 6, "M6: Releases", "parked"],
    ] as const)
      await milestones.create({
        id,
        projectId: "ai",
        name,
        outcome: `${name} works`,
        order,
        status,
        createdAt: AT,
        updatedAt: AT,
      });
    const polish = await service.create("ai", { type: "epic", title: "Board polish" }, "andy");
    await tracker.updateTicket("ai", polish.id, { fields: { milestoneId: "m4" } }, "andy");
    const releases = await service.create("ai", { type: "epic", title: "Releases" }, "andy");
    await tracker.updateTicket("ai", releases.id, { fields: { milestoneId: "m6" } }, "andy");
    await service.create("ai", { title: "Group ideas", parentId: polish.id }, "andy");
    await service.create("ai", { title: "Promote", parentId: releases.id }, "andy");
    await service.create("ai", { title: "Loose idea" }, "andy");
    const ready = await service.create(
      "ai",
      { ...readyStory, title: "Ready polish", parentId: polish.id },
      "andy",
    );
    await service.move("ai", ready.id, "ready", "andy");
    await extra?.(harness);
    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByText("AI-5");
    await waitFor(() => expect(header("M4: Epics")).toBeTruthy());
    return harness;
  }

  /** Ideas' rows: `m:<milestone>`, `e:<epic key>` (with `none`), and card keys. */
  const ideaRowsShown = () =>
    [
      ...screen
        .getByRole("region", { name: "Backlog" })
        .querySelectorAll("[data-idea-group], [data-ticket]"),
    ].map((el) =>
      el.hasAttribute("data-idea-group")
        ? `${el.getAttribute("data-level") === "milestone" ? "m" : "e"}:${el.getAttribute("data-label")}`
        : el.getAttribute("data-ticket"),
    );
  const header = (label: string) =>
    document.querySelector<HTMLElement>(`[data-idea-group][data-label="${label}"]`);
  const toggle = (label: string) => within(header(label)!).getByRole("button");
  const filterBox = () => screen.getByRole("searchbox", { name: "Filter tickets" });
  const keysIn = (lane: string) =>
    [...screen.getByRole("region", { name: lane }).querySelectorAll("[data-ticket]")].map((el) =>
      el.getAttribute("data-ticket"),
    );

  it("GivenIdeasUnderMilestonesAndEpics_WhenTheBoardShows_ThenTheyAreGroupedByMilestoneThenEpicWithCounts", async () => {
    await seeded();

    expect(ideaRowsShown()).toEqual([
      "m:M4: Epics",
      "e:AI-1",
      "AI-3",
      "m:M6: Releases",
      "m:none",
      "e:none",
      "AI-5",
    ]);
    expect(header("M4: Epics")!.textContent).toMatch(/1$/);
    expect(header("M6: Releases")!.textContent).toMatch(/1$/);
    expect(header("AI-1")!.textContent).toContain("Board polish");
    // The lane counts every idea, collapsed ones too, and no epic (AI-403).
    expect(screen.getByRole("region", { name: "Backlog" }).querySelector("h3")!.textContent).toBe(
      "Backlog 3",
    );
  });

  it("GivenAParkedMilestone_WhenTheBoardLoads_ThenItsGroupIsCollapsedAndOpensOnClick", async () => {
    const harness = await seeded();

    expect(toggle("M6: Releases").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("AI-4")).toBeNull();

    await harness.user.click(toggle("M6: Releases"));

    expect(ideaRowsShown()).toContain("AI-4");
    expect(toggle("M6: Releases").getAttribute("aria-expanded")).toBe("true");
  });

  it("GivenGroupsCollapsedAndOpened_WhenTheBoardIsOpenedAgain_ThenTheChoicesAreKept", async () => {
    const harness = await seeded();
    await harness.user.click(toggle("M4: Epics"));
    await harness.user.click(toggle("M6: Releases"));

    await harness.router.navigate({ to: "/p/ai/inbox" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Backlog" })).toBeNull());
    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByText("AI-5");

    expect(toggle("M4: Epics").getAttribute("aria-expanded")).toBe("false");
    expect(ideaRowsShown()).not.toContain("AI-3");
    expect(ideaRowsShown()).toContain("AI-4");
  });

  it("GivenAGroupCollapsedInOneProject_WhenAnotherProjectsBoardOpens_ThenItsChoicesStayApart", async () => {
    const harness = await seeded(async ({ tracker, milestones, service }) => {
      await tracker.createProject({ name: "Ops", key: "OPS" });
      await milestones.create({
        id: "m4",
        projectId: "ops",
        name: "M4: Ops",
        outcome: "Ops works",
        order: 4,
        status: "approved",
        createdAt: AT,
        updatedAt: AT,
      });
      const epic = await service.create("ops", { type: "epic", title: "Ops epic" }, "andy");
      await tracker.updateTicket("ops", epic.id, { fields: { milestoneId: "m4" } }, "andy");
      await service.create("ops", { title: "Ops idea", parentId: epic.id }, "andy");
    });
    // Load OPS once so its board is cached, then come back to AI and collapse M4 there.
    await harness.router.navigate({ to: "/p/ops" });
    await screen.findByText("OPS-2");
    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByText("AI-5");
    await waitFor(() => expect(header("M4: Epics")).toBeTruthy());
    await harness.user.click(toggle("M4: Epics"));

    await harness.router.navigate({ to: "/p/ops" });
    await screen.findByText("OPS-2");

    // Both projects' milestone groups are keyed "m4": OPS keeps its own (open) state.
    expect(toggle("M4: Ops").getAttribute("aria-expanded")).toBe("true");
    expect(ideaRowsShown()).toContain("OPS-2");
    const stored = JSON.parse(window.localStorage.getItem("andy.board.ideaGroups") ?? "{}");
    expect(stored).toEqual({ ai: { m4: true } });
  });

  it("GivenAGroupWithMoreThanTenIdeas_WhenTheBoardShows_ThenTenShowAndShowAllRevealsTheRest", async () => {
    const harness = await seeded(async ({ service }) => {
      for (let i = 1; i <= 11; i++) await service.create("ai", { title: `Idea ${i}` }, "andy");
    });

    const loose = () => ideaRowsShown().slice(ideaRowsShown().indexOf("e:none") + 1);
    expect(loose()).toHaveLength(10);
    expect(header("none")!.textContent).toMatch(/12$/);

    await harness.user.click(screen.getByRole("button", { name: "Show all 12" }));

    expect(loose()).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("GivenTextInTheFilterBox_WhenTyped_ThenEveryLaneShowsOnlyMatchesByKeyTitleOrEpicTitle", async () => {
    const harness = await seeded();

    // "polish": AI-3 by its epic's title, AI-6's own title (in Ready); AI-1 is an epic, no card.
    await harness.user.type(filterBox(), "polish");

    await waitFor(() => expect(keysIn("Backlog")).toEqual(["AI-3"]));
    expect(keysIn("Ready")).toEqual(["AI-6"]);
    expect(harness.router.state.location.search).toMatchObject({ q: "polish" });

    await harness.user.clear(filterBox());
    await harness.user.type(filterBox(), "ai-4");
    // The parked group opens while the filter shows one of its tickets.
    await waitFor(() => expect(keysIn("Backlog")).toEqual(["AI-4"]));
    expect(keysIn("Ready")).toEqual([]);
  });

  it("GivenAFilter_WhenEscapeIsPressedInTheBox_ThenItClearsAndEveryTicketShowsAgain", async () => {
    const harness = await seeded();
    await harness.user.type(filterBox(), "loose");
    await waitFor(() => expect(keysIn("Backlog")).toEqual(["AI-5"]));

    await harness.user.keyboard("{Escape}");

    await waitFor(() => expect(keysIn("Backlog")).toEqual(["AI-3", "AI-5"]));
    expect((filterBox() as HTMLInputElement).value).toBe("");
    expect(harness.router.state.location.search).not.toHaveProperty("q");
  });

  it("GivenAFilterInTheUrl_WhenTheBoardLoads_ThenTheBoxHoldsItAndCmdKStillOpensThePalette", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    await harness.service.create("ai", { title: "Alpha" }, "andy");
    await harness.service.create("ai", { title: "Beta" }, "andy");
    await harness.router.navigate({ to: "/p/ai", search: { q: "beta" } });
    await screen.findByText("AI-2");

    expect((filterBox() as HTMLInputElement).value).toBe("beta");
    expect(screen.queryByText("AI-1")).toBeNull();

    filterBox().focus();
    await harness.user.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("dialog", { name: "Search and commands" })).toBeTruthy();
  });

  it("GivenACollapsedParkedGroup_WhenAnIdeaIsDraggedOntoUpNext_ThenItEntersUpNext", async () => {
    const harness = await seeded(async ({ service }) => {
      await service.create("ai", { title: "Queued" }, "andy", { upNext: true });
    });
    // Rows: AI-7 (Up next), then AI-3 (M4), AI-5; AI-4 sits in M6, collapsed.
    expect(keysIn("Backlog")).toEqual(["AI-7", "AI-3", "AI-5"]);

    await drag(harness.user, "AI-3", 0, -1);

    await waitFor(async () =>
      expect((await harness.tracker.listTickets("ai")).find((t) => t.key === "AI-3")).toMatchObject(
        { stage: "backlog", upNextRank: expect.any(String) },
      ),
    );
  });

  it("GivenACollapsedParkedGroup_WhenAnUpNextCardIsDraggedOntoAnIdea_ThenItLandsInIdeas", async () => {
    const harness = await seeded(async ({ service }) => {
      await service.create("ai", { title: "Queued" }, "andy", { upNext: true });
    });

    await drag(harness.user, "AI-7", 0, 2);

    await waitFor(async () =>
      expect((await harness.tracker.listTickets("ai")).find((t) => t.key === "AI-7")).toMatchObject(
        { stage: "backlog", upNextRank: null },
      ),
    );
    expect(toggle("M6: Releases").getAttribute("aria-expanded")).toBe("false");
  });
});

/** AI-403: Board shows epics as group headers, not cards. */
describe("epics as group headers, not cards", () => {
  /**
   * AI-1 "Board polish" is an epic forced into Ready with child AI-2 in Ready and Done child AI-3;
   * AI-4 "Child epic" is an epic under AI-1 with child AI-5 in Ready; AI-6 "Empty epic" has no
   * tickets; AI-7 is a loose Ready ticket. `idea` adds AI-8 "An idea" under AI-1, in Ideas.
   */
  async function seeded({ idea = false } = {}) {
    const harness = renderApp();
    const { service } = harness;
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const epic = await service.create("ai", { type: "epic", title: "Board polish" }, "andy");
    await service.move("ai", epic.id, "ready", "andy", { force: true });
    const inReady = await service.create(
      "ai",
      { ...readyStory, title: "Header link", parentId: epic.id },
      "andy",
    );
    await service.move("ai", inReady.id, "ready", "andy");
    const done = await service.create("ai", { title: "Shipped", parentId: epic.id }, "andy");
    await service.move("ai", done.id, "done", "andy", { force: true });
    const child = await service.create(
      "ai",
      { type: "epic", title: "Child epic", parentId: epic.id },
      "andy",
    );
    const underChild = await service.create(
      "ai",
      { ...readyStory, title: "Nested", parentId: child.id },
      "andy",
    );
    await service.move("ai", underChild.id, "ready", "andy");
    await service.create("ai", { type: "epic", title: "Empty epic" }, "andy");
    const loose = await service.create("ai", { ...readyStory, title: "Loose" }, "andy");
    await service.move("ai", loose.id, "ready", "andy");
    if (idea) await service.create("ai", { title: "An idea", parentId: epic.id }, "andy");
    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByText("AI-7");
    return harness;
  }

  const keysIn = (lane: string) =>
    [...screen.getByRole("region", { name: lane }).querySelectorAll("[data-ticket]")].map((el) =>
      el.getAttribute("data-ticket"),
    );
  const laneCount = (lane: string) =>
    screen.getByRole("region", { name: lane }).querySelector("h3")!.textContent;
  const pathname = (h: ReturnType<typeof renderApp>) => h.router.state.location.pathname;

  it("GivenEpicsInLanes_WhenTheBoardShows_ThenNoLaneHasAnEpicCardAndCountsLeaveThemOut", async () => {
    await seeded();

    expect(keysIn("Ready")).toEqual(["AI-2", "AI-5", "AI-7"]);
    expect(keysIn("Backlog")).toEqual([]);
    expect(laneCount("Ready")).toBe("Ready 3");
    expect(laneCount("Backlog")).toBe("Backlog 0");
    // The All chip counts tickets that get a card: three in Ready, one Done.
    expect(screen.getByRole("button", { name: /^All/ }).textContent).toMatch(/4$/);
  });

  it("GivenGroupByEpic_WhenAHeaderIsClicked_ThenItShowsTitleAndProgressAndOpensTheEpicsPanel", async () => {
    const harness = await seeded();
    await harness.user.click(screen.getByRole("switch", { name: "Group by epic" }));

    const header = document.querySelector<HTMLElement>('[data-epic="AI-1"]')!;
    expect(header.textContent).toContain("Board polish");
    // Done of non-cancelled tickets: AI-3 of AI-2, AI-3 and child epic AI-4.
    expect(header.textContent).toContain("1 of 3 done");
    await harness.user.click(
      within(header).getByRole("link", { name: "Open epic AI-1: Board polish" }),
    );

    await waitFor(() => expect(pathname(harness)).toBe("/p/ai/t/AI-1"));
  });

  it("GivenAChildEpic_WhenGroupedByEpic_ThenItsHeaderNamesItsParentAndOpensItsPanel", async () => {
    const harness = await seeded();
    await harness.user.click(screen.getByRole("switch", { name: "Group by epic" }));

    const header = document.querySelector<HTMLElement>('[data-epic="AI-4"]')!;
    expect(header.textContent).toMatch(/^AI-1 ›AI-4Child epic/);
    await harness.user.click(within(header).getByRole("link", { name: /^Open epic AI-4/ }));

    await waitFor(() => expect(pathname(harness)).toBe("/p/ai/t/AI-4"));
  });

  it("GivenAnIdeaUnderAnEpic_WhenTheIdeasHeaderIsShown_ThenItLinksToTheEpicWithProgressAndStillCollapses", async () => {
    const harness = await seeded({ idea: true });
    const header = document.querySelector<HTMLElement>('[data-idea-group][data-label="AI-1"]')!;

    expect(header.textContent).toContain("1 of 4 done");
    await harness.user.click(within(header).getByRole("button", { name: "Collapse AI-1 ideas" }));
    expect(screen.queryByText("An idea")).toBeNull();
    await harness.user.click(within(header).getByRole("link", { name: /^Open epic AI-1/ }));
    await waitFor(() => expect(pathname(harness)).toBe("/p/ai/t/AI-1"));
  });

  it("GivenAnEpicWithNoTickets_WhenPickedInTheEpicFilter_ThenOpenGoesToItsPanel", async () => {
    const harness = await seeded();

    await harness.user.click(screen.getByRole("combobox", { name: "Epic" }));
    await harness.user.click(await screen.findByRole("option", { name: "AI-6: Empty epic" }));
    await harness.user.click(screen.getByRole("link", { name: "Open epic AI-6: Empty epic" }));

    await waitFor(() => expect(pathname(harness)).toBe("/p/ai/t/AI-6"));
  });

  it("GivenANewTicket_WhenItsTypeIsSetToEpicInItsPanel_ThenThePanelStaysOpenAndItsCardLeaves", async () => {
    const harness = await seeded();
    await harness.user.type(screen.getByLabelText("Add a ticket"), "New epic{Enter}");
    await waitFor(() => expect(keysIn("Backlog")).toEqual(["AI-8"]));
    await harness.router.navigate({ to: "/p/ai/t/$ticketRef", params: { ticketRef: "AI-8" } });

    await pick(harness.user, await screen.findByRole("combobox", { name: "Type" }), "Epic");

    await waitFor(() => expect(keysIn("Backlog")).toEqual([]));
    expect(pathname(harness)).toBe("/p/ai/t/AI-8");
    expect(screen.getByRole("combobox", { name: "Type" }).textContent).toContain("Epic");
  });

  it("GivenTheBoard_WhenAndySearchesAnEpicInThePalette_ThenItIsFoundAndOpens", async () => {
    const harness = await seeded();

    await harness.user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Search and commands" });
    await harness.user.type(
      screen.getByRole("combobox", { name: "Search tickets and commands" }),
      "Empty epic",
    );
    const tickets = await screen.findByRole("group", { name: "Tickets" });
    await harness.user.click(within(tickets).getAllByRole("option")[0]!);

    await waitFor(() => expect(pathname(harness)).toBe("/p/ai/t/AI-6"));
  });
});
