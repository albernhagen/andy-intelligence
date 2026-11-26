import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { STAGES } from "@/lib/tickets";
import { readyStory, renderApp } from "@/test/harness";
import { dragCopySource } from "@/test/drag-layout";

/**
 * Board work view chips (AI-187): All plus five fixed views, kept in `?view=`. Drags use dnd-kit's
 * keyboard sensor over fake rects, as in board.test.tsx.
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
  const row = Math.max(0, [...lane!.querySelectorAll("[data-ticket]")].indexOf(el));
  return new DOMRect(i * COLUMN_WIDTH + 10, 40 + row * CARD_STEP, COLUMN_WIDTH - 20, 50);
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return fakeRect(this);
  });
});
afterEach(() => vi.restoreAllMocks());

/**
 * AI-1 and AI-3: Ready, Andy's. AI-2: Ready, an agent's. AI-4: Backlog with an open question.
 * AI-5: blocked by AI-4. AI-6: Ready for review. AI-7: Done, Andy's.
 */
async function seeded(path?: string) {
  const harness = renderApp();
  const { service, tracker } = harness;
  await tracker.createProject({ name: "AI", key: "AI" });
  const ids: string[] = [];
  for (const [title, worker] of [
    ["Mine A", "me"],
    ["Agent work", "agent"],
    ["Mine B", "me"],
  ] as const) {
    const t = await service.create("ai", { ...readyStory, title }, "andy");
    await service.setWorker("ai", t.id, worker, "andy");
    await service.move("ai", t.id, "ready", "andy");
    ids.push(t.id);
  }
  const asked = await service.create("ai", { title: "Asked" }, "andy");
  await service.setWorker("ai", asked.id, "agent", "andy");
  await service.ask("ai", asked.id, { text: "Which way?" }, "andy");
  const blocked = await service.create("ai", { title: "Blocked", blockedBy: [asked.id] }, "andy");
  await service.setWorker("ai", blocked.id, "agent", "andy");
  const review = await service.create("ai", { title: "Review" }, "andy");
  await service.setWorker("ai", review.id, "agent", "andy");
  await tracker.updateTicket(
    "ai",
    review.id,
    { stage: { to: "ready_for_review", reason: null } },
    "andy",
  );
  const done = await service.create("ai", { title: "Done" }, "andy");
  await service.setWorker("ai", done.id, "me", "andy");
  await service.move("ai", done.id, "done", "andy", { force: true });

  await harness.router.navigate({ href: path ?? "/p/ai" });
  await screen.findByRole("group", { name: "Work view" });
  await waitFor(() => expect(shownCards().length).toBeGreaterThan(0));
  return harness;
}

function shownCards() {
  return [...document.querySelectorAll("[data-ticket]")].map((el) =>
    el.getAttribute("data-ticket"),
  );
}
const chip = (name: RegExp) => screen.getByRole("button", { name });

describe("board work views", () => {
  it("GivenABoard_WhenItLoads_ThenEachChipShowsItsOpenTicketCount", async () => {
    await seeded();

    expect(chip(/^All 7$/).getAttribute("aria-pressed")).toBe("true");
    expect(chip(/^Needs you · 1 ticket$/)).toBeTruthy();
    expect(chip(/^Mine 2$/)).toBeTruthy();
    expect(chip(/^Agents 4$/)).toBeTruthy();
    expect(chip(/^Blocked 1$/)).toBeTruthy();
    expect(chip(/^In review 1$/)).toBeTruthy();
  });

  it("GivenAStaleTicketAndAWorkerToPick_WhenTheBoardLoads_ThenTheChipNamesThemAndMatchesTheHeader", async () => {
    const harness = await seeded();
    const { service } = harness;
    const [, , , asked, , , done] = await harness.tracker.listTickets("ai");
    // AI-4 gets a second question (still one ticket); AI-7 is Done with one (stale); AI-8 waits
    // only for a worker to be picked (AI-347).
    await service.ask("ai", asked!.id, { text: "And when?" }, "andy");
    await service.ask("ai", done!.id, { text: "Still needed?" }, "andy");
    // Every seeded ticket picked its worker, so only the new one follows the default.
    await harness.tracker.updateProject("ai", { defaultWorker: "ask" });
    await service.create("ai", { title: "Who builds it?" }, "andy");
    await harness.queryClient.invalidateQueries();

    await waitFor(() =>
      expect(chip(/^Needs you · 2 tickets · 1 stale · 1 to pick a worker$/)).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Inbox 2 tickets waiting on you" })).toBeTruthy(),
    );
  });

  it("GivenAChip_WhenClicked_ThenOnlyItsTicketsShowAndTheUrlNamesIt", async () => {
    const harness = await seeded();

    await harness.user.click(chip(/^Mine/));

    await waitFor(() => expect(shownCards()).toEqual(["AI-1", "AI-3"]));
    expect(harness.router.state.location.search).toEqual({ view: "mine" });
    expect(chip(/^Mine/).getAttribute("aria-pressed")).toBe("true");

    await harness.user.click(chip(/^All/));
    await waitFor(() => expect(shownCards()).toHaveLength(6));
    expect(harness.router.state.location.search).toEqual({});
  });

  it("GivenATicketWithAQuestion_WhenNeedsMeIsPicked_ThenItIsShown", async () => {
    const harness = await seeded();

    await harness.user.click(chip(/^Needs you/));

    await waitFor(() => expect(shownCards()).toEqual(["AI-4"]));
  });

  it("GivenAViewInTheUrl_WhenTheBoardOpens_ThenThatViewApplies", async () => {
    await seeded("/p/ai?view=blocked");

    await waitFor(() => expect(shownCards()).toEqual(["AI-5"]));
    expect(chip(/^Blocked/).getAttribute("aria-pressed")).toBe("true");
  });

  it("GivenAnUnknownViewInTheUrl_WhenTheBoardOpens_ThenAllTicketsShow", async () => {
    await seeded("/p/ai?view=everything");

    expect(shownCards()).toHaveLength(6);
    expect(chip(/^All/).getAttribute("aria-pressed")).toBe("true");
  });

  it("GivenAViewAndScoreSort_WhenTheSortIsToggled_ThenTheViewStays", async () => {
    const harness = await seeded("/p/ai?view=mine");

    await harness.user.click(screen.getByRole("button", { name: "Sort by score" }));

    await waitFor(() =>
      expect(harness.router.state.location.search).toEqual({ sort: "score", view: "mine" }),
    );
    expect(shownCards()).toEqual(["AI-1", "AI-3"]);
  });

  it("GivenAView_WhenACardIsDraggedAboveAnother_ThenItIsRankedAsUnfiltered", async () => {
    const harness = await seeded("/p/ai?view=mine");
    await waitFor(() => expect(shownCards()).toEqual(["AI-1", "AI-3"]));

    const card = document.querySelector<HTMLElement>('[data-ticket="AI-3"]')!;
    card.focus();
    await harness.user.keyboard(" ");
    await harness.user.keyboard("{ArrowUp}".repeat(Math.round(CARD_STEP / 25)));
    await harness.user.keyboard(" ");

    await waitFor(async () => {
      const ready = (await harness.tracker.listTickets("ai", { stage: "ready" })).sort((a, b) =>
        a.rank < b.rank ? -1 : 1,
      );
      expect(ready.map((t) => t.key)).toEqual(["AI-3", "AI-1", "AI-2"]);
    });
    expect(shownCards()).toEqual(["AI-3", "AI-1"]);
  });
});
