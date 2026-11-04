import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { STAGES } from "@/lib/tickets";
import { readyStory, renderApp } from "@/test/harness";

/**
 * Board drag-and-drop (AI-16), driven with dnd-kit's keyboard sensor: Space picks a card up,
 * arrows move it 25px a press, Space drops it. jsdom has no layout, so columns get fake
 * 200px-wide rects side by side and each card sits inside its column.
 */
const COLUMN_WIDTH = 200;

function fakeRect(el: Element): DOMRect {
  const column = el.closest("[data-stage]");
  const i = column ? STAGES.indexOf(column.getAttribute("data-stage") as never) : -1;
  if (i < 0) return new DOMRect(0, 0, 0, 0);
  if (el.hasAttribute("data-stage")) return new DOMRect(i * COLUMN_WIDTH, 0, COLUMN_WIDTH, 1000);
  return new DOMRect(i * COLUMN_WIDTH + 10, 40, COLUMN_WIDTH - 20, 50);
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return fakeRect(this);
  });
});
afterEach(() => vi.restoreAllMocks());

/** Picks the card up, moves it `columns` to the right, and drops it. */
async function drag(user: ReturnType<typeof renderApp>["user"], key: string, columns: number) {
  const card = document.querySelector<HTMLElement>(`[data-ticket="${key}"]`)!;
  card.focus();
  await user.keyboard(" ");
  await user.keyboard("{ArrowRight}".repeat((columns * COLUMN_WIDTH) / 25));
  await user.keyboard(" ");
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
    const { harness, ticket } = await boardWith({ type: "task", title: "Spike" });

    await drag(harness.user, ticket.key, 5);

    const done = screen.getByRole("region", { name: "Done" });
    expect(await within(done).findByText(ticket.key)).toBeTruthy();
    expect((await harness.service.history("ai", ticket.id)).at(-1)).toMatchObject({
      kind: "stage_changed",
      body: null,
      data: { from: "backlog", to: "done", forced: true },
    });
  });

  it("GivenATicketMissingDoR_WhenDraggedToReady_ThenTheErrorShowsAndTheCardStaysInBacklog", async () => {
    const { harness, ticket } = await boardWith({ type: "story", title: "Board" });

    await drag(harness.user, ticket.key, 1);

    expect((await screen.findByRole("alert")).textContent).toMatch(/Definition of Ready/);
    const backlog = screen.getByRole("region", { name: "Backlog" });
    expect(within(backlog).getByText(ticket.key)).toBeTruthy();
    await waitFor(async () =>
      expect((await harness.tracker.getTicket("ai", ticket.id))?.stage).toBe("backlog"),
    );
  });
});
