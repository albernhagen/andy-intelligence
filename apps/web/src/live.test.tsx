import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { IDLE_POLL_MS, LIVE_POLL_MS } from "@/lib/live";
import { renderApp } from "@/test/harness";

/** Live UI updates by tuned polling (AI-9), against the in-process API. */

async function openBoard(opts: Parameters<typeof renderApp>[1] = {}) {
  const harness = renderApp("/", opts);
  await harness.tracker.createProject({ name: "AI", key: "AI" });
  const first = await harness.service.create("ai", { type: "feature", title: "First" }, "andy");
  await harness.router.navigate({ to: "/p/ai" });
  const backlog = await screen.findByRole("region", { name: "Backlog" });
  await within(backlog).findByText(first.key);
  return { ...harness, backlog, first };
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("live updates (AI-9)", () => {
  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("GivenTheBoardOpen_WhenATicketChangesOnTheServer_ThenTheBoardShowsItWithinFiveSeconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { backlog, service, first } = await openBoard();

    // Another session (MCP, an agent run) writes; the UI made no request for it.
    const second = await service.create("ai", { type: "chore", title: "Made elsewhere" }, "agent");
    await service.update("ai", first.id, { title: "First, renamed" }, "agent");
    expect(within(backlog).queryByText(second.key)).toBeNull();

    await tick(LIVE_POLL_MS);

    expect(await within(backlog).findByText(second.key)).toBeTruthy();
    expect(await within(backlog).findByText("First, renamed")).toBeTruthy();
  });

  it("GivenTheTabHidden_WhenTimePasses_ThenNothingPollsAndFocusRefetches", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const requests: string[] = [];
    const { backlog, service } = await openBoard({
      beforeFetch: async (r) => void requests.push(new URL(r.url).pathname),
    });
    focusManager.setFocused(false);
    await tick(0);
    requests.length = 0;

    const second = await service.create("ai", { type: "chore", title: "While hidden" }, "agent");
    await tick(IDLE_POLL_MS * 3);
    expect(requests).toEqual([]);

    await act(async () => focusManager.setFocused(true));
    expect(await within(backlog).findByText(second.key)).toBeTruthy();
  });

  it("GivenTheApiUnreachable_WhenPollsFail_ThenUpdatesDelayedShowsAndClearsOnRecovery", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let down = false;
    const { backlog, service } = await openBoard({
      beforeFetch: async () => {
        if (down) throw new TypeError("Failed to fetch");
      },
    });

    down = true;
    await tick(LIVE_POLL_MS);
    expect(await screen.findByText(/Updates delayed/)).toBeTruthy();
    // The board keeps its last data instead of turning into an error.
    expect(within(backlog).getByText("First")).toBeTruthy();

    down = false;
    const second = await service.create("ai", { type: "chore", title: "After outage" }, "agent");
    await tick(IDLE_POLL_MS);
    expect(await within(backlog).findByText(second.key)).toBeTruthy();
    expect(screen.queryByText(/Updates delayed/)).toBeNull();
  });
});
