import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { readyStory, renderApp } from "@/test/harness";

const scores = (risk: string, confidence: string) => ({
  risk,
  riskReason: `${risk} because`,
  confidence,
  confidenceReason: `${confidence} because`,
});

/** Three Ready tickets; rank order is the order of creation. */
async function queue() {
  const harness = renderApp();
  await harness.tracker.createProject({ name: "AI", key: "AI" });
  const add = async (title: string, size: "S" | "L", fields: object) => {
    const t = await harness.service.create("ai", { ...readyStory, title, size }, "andy");
    return harness.tracker.updateTicket(
      "ai",
      t.id,
      { fields, stage: { to: "ready", forced: false, reason: null } },
      "system",
    );
  };
  const tickets = [
    await add("Big", "L", scores("low", "high")),
    await add("Unscored", "S", {}),
    await add("Small", "S", scores("high", "low")),
  ];
  return { harness, tickets };
}

const laneKeys = () =>
  [...screen.getByRole("region", { name: "Ready" }).querySelectorAll("[data-ticket]")].map((c) =>
    c.getAttribute("data-ticket"),
  );

describe("start score on the board", () => {
  it("GivenAScoredTicket_WhenTheBoardShows_ThenItsCardHasTheThreeMarkers", async () => {
    const { harness } = await queue();
    await harness.router.navigate({ to: "/p/$projectId", params: { projectId: "ai" } });
    await screen.findByRole("region", { name: "Ready" });
    const card = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-ticket="AI-3"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(within(card).getByText("S")).toBeTruthy();
    expect(within(card).getByText("high risk")).toBeTruthy();
    expect(within(card).getByText("not confident")).toBeTruthy();
  });

  it("GivenNoParameter_WhenTheBoardShows_ThenReadyIsInRankOrder", async () => {
    const { harness } = await queue();
    await harness.router.navigate({ to: "/p/$projectId", params: { projectId: "ai" } });
    await screen.findByText("AI-3");
    expect(laneKeys()).toEqual(["AI-1", "AI-2", "AI-3"]);
  });

  it("GivenTheSortParameter_WhenTheBoardShows_ThenReadyIsByScoreAndRanksDontChange", async () => {
    const { harness, tickets } = await queue();
    await harness.router.navigate({
      to: "/p/$projectId",
      params: { projectId: "ai" },
      search: { sort: "score" },
    });
    await screen.findByText("AI-3");
    // S with risk, then S with none (missing sorts last), then L.
    expect(laneKeys()).toEqual(["AI-3", "AI-2", "AI-1"]);
    // Card numbers stay the queue's.
    const first = document.querySelector<HTMLElement>('[data-ticket="AI-3"]')!;
    expect(within(first).getByLabelText("Position 3")).toBeTruthy();

    const stored = await harness.tracker.listTickets("ai", { stage: "ready" });
    expect(stored.map((t) => t.rank)).toEqual(tickets.map((t) => t.rank));
  });

  it("GivenTheToggle_WhenClicked_ThenTheUrlCarriesTheSortAndClickingAgainClearsIt", async () => {
    const { harness } = await queue();
    await harness.router.navigate({ to: "/p/$projectId", params: { projectId: "ai" } });
    await screen.findByText("AI-3");
    await harness.user.click(screen.getByRole("button", { name: "Sort by score" }));
    await waitFor(() => expect(harness.router.state.location.search).toEqual({ sort: "score" }));
    expect(laneKeys()[0]).toBe("AI-3");
    await harness.user.click(screen.getByRole("button", { name: /show queue order/ }));
    await waitFor(() => expect(harness.router.state.location.search).toEqual({}));
    expect(laneKeys()[0]).toBe("AI-1");
  });

  it("GivenAScoredTicket_WhenOpened_ThenThePanelShowsTheReasons", async () => {
    const { harness } = await queue();
    await harness.router.navigate({
      to: "/p/$projectId/t/$ticketRef",
      params: { projectId: "ai", ticketRef: "AI-3" },
    });
    const section = await screen.findByRole("region", { name: "Start score" });
    expect(within(section).getByText("S · high risk · not confident")).toBeTruthy();
    expect(within(section).getByText("high because")).toBeTruthy();
    expect(within(section).getByText("low because")).toBeTruthy();
  });
});
