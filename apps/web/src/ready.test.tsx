import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { PAGE_LOAD, renderApp } from "@/test/harness";

/**
 * The board's Ready lane filters (AI-343): size, risk and confidence, the same as MCP
 * `list_ready` (AI-298). The Ready page is gone; its URL opens the board with its filters.
 */
describe("Ready lane filters", () => {
  async function seeded(path: string) {
    const h = renderApp("/all/board");
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    const ready = async (title: string, fields: Record<string, unknown>) => {
      const t = await h.tracker.createTicket("ai", { type: "chore", title }, "andy");
      await h.tracker.updateTicket(
        "ai",
        t.id,
        { fields, stage: { to: "ready", forced: false, reason: null } },
        "system",
      );
    };
    await ready("Small and safe", { size: "S", risk: "low", confidence: "high" });
    await ready("Big", { size: "L", risk: "high", confidence: "low" });
    await ready("Unscored", {});
    await h.queryClient.invalidateQueries();
    await h.router.navigate({ href: path });
    return h;
  }

  const readyTitles = async () => {
    const lane = await screen.findByRole("region", { name: "Ready" }, PAGE_LOAD);
    return within(lane)
      .queryAllByRole("link")
      .map((a) => a.textContent ?? "")
      .filter((t) => ["Small and safe", "Big", "Unscored"].some((x) => t.includes(x)));
  };

  it("GivenTheReadyLane_WhenAndyFiltersBySize_ThenOnlyMatchingCardsShowAndTheUrlFollows", async () => {
    const h = await seeded("/p/ai");
    await waitFor(async () => expect(await readyTitles()).toHaveLength(3));

    await h.user.click(screen.getByRole("button", { name: "Filter" }));
    await h.user.selectOptions(screen.getByLabelText("Size"), "S");

    await waitFor(() => expect(h.router.state.location.search).toEqual({ size: "S" }));
    await waitFor(async () => {
      const titles = await readyTitles();
      expect(titles).toHaveLength(1);
      expect(titles[0]).toContain("Small and safe");
    });
    expect(screen.getByRole("button", { name: "Filter · 1" })).toBeTruthy();
  });

  it("GivenFilters_WhenCleared_ThenEveryReadyCardShowsAgain", async () => {
    const h = await seeded("/p/ai?risk=high");
    await waitFor(async () => expect(await readyTitles()).toHaveLength(1));

    await h.user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(async () => expect(await readyTitles()).toHaveLength(3));
  });

  it("GivenTheOldReadyPageUrl_WhenOpened_ThenTheBoardOpensWithItsFilters", async () => {
    const h = await seeded("/p/ai/ready?confidence=low");

    await waitFor(() => expect(h.router.state.location.pathname).toBe("/p/ai"));
    expect(h.router.state.location.search).toEqual({ confidence: "low" });
    await waitFor(async () => {
      const titles = await readyTitles();
      expect(titles).toHaveLength(1);
      expect(titles[0]).toContain("Big");
    });
  });
});
