import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Markers, MOVE_TRANSITION } from "@/components/board/BoardCard";
import { WorkViewMenu } from "@/components/board/WorkViewChips";
import { BoardSkeleton, KeyHints } from "@/pages/BoardPage";
import { PAGE_LOAD, renderApp } from "@/test/harness";

/** AI-374: Board and cards on the new design (direction A, ADR-0151). Behaviour: board.test.tsx. */

async function boardWith(titles: string[]) {
  const harness = renderApp();
  await harness.tracker.createProject({ name: "AI", key: "AI" });
  for (const title of titles) await harness.service.create("ai", { title }, "andy");
  await harness.router.navigate({ to: "/p/ai" });
  await screen.findByRole("region", { name: "Backlog" }, PAGE_LOAD);
  return harness;
}

describe("board on direction A", () => {
  it("GivenTheBoard_WhenItShows_ThenGroupByEpicAndShowCancelledAreSwitchesThatToggle", async () => {
    const harness = await boardWith(["One"]);

    for (const name of ["Group by epic", "Show cancelled and archived"]) {
      const toggle = screen.getByRole("switch", { name });
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      await harness.user.click(toggle);
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    }
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("GivenTheBoardIsLoading_WhenItRenders_ThenLaneShapedSkeletonsShowInsteadOfASpinner", () => {
    render(<BoardSkeleton />);

    const status = screen.getByRole("status", { name: "Loading the board" });
    expect(status.querySelectorAll('[data-slot="lane-skeleton"]')).toHaveLength(4);
    expect(status.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(4);
  });

  it("GivenAnEmptyUpNext_WhenTheBoardShows_ThenItSaysWhatADropThereDoes", async () => {
    await boardWith(["One"]);

    const backlog = screen.getByRole("region", { name: "Backlog" });
    expect(within(backlog).getByText("Drag a ticket here to start refine.")).toBeTruthy();
  });

  it("GivenTheBoard_WhenItShows_ThenTheKeyHintsNameOnlyKeysThatWork", () => {
    render(<KeyHints />);

    expect(screen.getByLabelText("Board keys").textContent).toBe(
      "JK card ·↵ open ·Space pick up, arrows move,Space drop ·Esc cancel",
    );
  });

  it("GivenTheReadyFilters_WhenOpened_ThenEachShowsEveryOptionWithAnyFirst", async () => {
    const harness = await boardWith(["One"]);

    await harness.user.click(screen.getByRole("button", { name: "Filter" }));

    const options = (name: string) =>
      within(screen.getByRole("group", { name }))
        .getAllByRole("button")
        .map((b) => b.textContent);
    expect(options("Size")).toEqual(["Any", "S", "M", "L"]);
    expect(options("Risk")).toEqual(["Any", "low", "medium", "high"]);
    expect(options("Confidence")).toEqual(["Any", "high", "medium", "low"]);
    expect(screen.queryByRole("combobox", { name: "Size" })).toBeNull();
  });

  it("GivenThePhoneViewMenu_WhenAScreenReaderReachesIt_ThenItHearsTheCurrentViewAndCount", () => {
    render(
      <WorkViewMenu
        view="agents"
        counts={{ "needs-me": 1, mine: 0, agents: 9, blocked: 1, "in-review": 2 }}
        needsYou={{ tickets: 1, stale: 0, toPickWorker: 0 }}
        total={11}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole("combobox", { name: "View Agents 9" })).toBeTruthy();
  });

  it("GivenACardBeingDragged_WhenOthersMakeRoom_ThenTheyMoveInTheBaseDurationWithStandardEasing", () => {
    expect(MOVE_TRANSITION).toEqual({ duration: 150, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  });
});

describe("card markers keep a word beside their colour (design-status-markers.md)", () => {
  it("GivenEveryMarker_WhenTheCardShows_ThenEachBadgeHasAWord", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const ticket = await harness.service.create("ai", { title: "Scored" }, "andy");

    render(
      <Markers
        ticket={{ ...ticket, size: "M", risk: "high", confidence: "low" }}
        openQuestions={2}
        needsAttention
        run="Refining · 3 min"
        pullRequest={{ number: 12, url: "https://github.com/a/b/pull/12", state: "open" }}
        blockers={[{ key: "AI-3" }]}
        archived
        sentBack="Needs a clearer scope"
        worker="me"
        stage="in_progress"
        type="feature"
      />,
    );

    for (const word of [
      "2 questions",
      "Refining · 3 min",
      "PR #12 · open",
      "Blocked by AI-3",
      "Archived",
      "Sent back",
      "Mine",
    ])
      expect(screen.getByText(word)).toBeTruthy();
    const badges = document.querySelectorAll("span.rounded-md");
    expect(badges.length).toBeGreaterThanOrEqual(10);
    for (const badge of badges) expect(badge.textContent?.trim()).not.toBe("");
  });

  it("GivenATypedTicket_WhenItsCardShows_ThenTheTypeHasAnIconAndItsName", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    await harness.service.create("ai", { title: "A bug", type: "bug" }, "andy");
    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByText("A bug", undefined, PAGE_LOAD);

    const card = document.querySelector<HTMLElement>('[data-ticket="AI-1"]')!;
    expect(card.querySelector('[title="Bug"] svg')).not.toBeNull();
    expect(within(card).getAllByText("Bug").length).toBeGreaterThan(0);
  });
});
