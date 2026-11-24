import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { PAGE_LOAD, renderApp } from "@/test/harness";

/**
 * AI-378: Roadmap, Work, What's new, Dashboards, GitHub and Local runners on direction A. Each
 * shows a skeleton while its first read loads, an empty state with one next step, and no native
 * select or checkbox.
 */

// Radix Checkbox and Select call APIs jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.scrollIntoView ??= () => {};

const SCREENS = [
  { name: "Roadmap", path: "/p/ai/roadmap", read: "/roadmap" },
  { name: "Work", path: "/p/ai/work", read: "/api/work" },
  { name: "What's new", path: "/p/ai/whats-new", read: "/whats-new" },
  { name: "Dashboards", path: "/p/ai/dashboards", read: "/dashboard" },
  { name: "GitHub", path: "/settings/github", read: "/api/github" },
  { name: "Local runners", path: "/settings/runners", read: "/api/runners" },
] as const;

/** The app on `/projects` with project AI; `hold` keeps matching reads pending until released. */
async function withProject(hold?: string) {
  let holding = false;
  const h = renderApp("/projects", {
    beforeFetch: async (req) => {
      if (holding && hold && new URL(req.url).pathname.includes(hold) && req.method === "GET")
        await new Promise(() => {});
    },
  });
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  holding = true;
  return h;
}

describe("AI-378 screens", () => {
  it.each(SCREENS.map((s) => [s.name, s] as const))(
    "Given%sFirstReadPending_WhenTheScreenOpens_ThenASkeletonShows",
    async (_, { path, read }) => {
      const h = await withProject(read);
      await h.router.navigate({ href: path });

      const loading = await screen.findByRole("status", { name: "Loading" }, PAGE_LOAD);
      expect(loading.querySelector('[data-slot="skeleton"]')).toBeTruthy();
    },
  );

  it.each(SCREENS.map((s) => [s.name, s] as const))(
    "Given%sLoaded_WhenShown_ThenNoNativeSelectOrCheckbox",
    async (_, { name, path }) => {
      const h = await withProject();
      await h.router.navigate({ href: path });

      await screen.findByRole("heading", { name, level: 2 }, PAGE_LOAD);
      await waitFor(() => expect(screen.queryByRole("status", { name: "Loading" })).toBeNull());
      const main = document.querySelector("main")!;
      // Radix keeps a hidden native input for forms (aria-hidden); a visible one is the native control.
      expect(main.querySelector('select:not([aria-hidden="true"])')).toBeNull();
      expect(main.querySelector('input[type="checkbox"]:not([aria-hidden="true"])')).toBeNull();
    },
  );

  it("GivenNothingInNeedsYou_WhenWorkOpens_ThenItSaysSoAndOffersTheBoard", async () => {
    const h = await withProject();
    await h.router.navigate({ href: "/p/ai/work" });

    expect(await screen.findByText("Nothing in Needs you.", undefined, PAGE_LOAD)).toBeTruthy();
    const open = screen.getByRole("link", { name: "Open the board" });
    expect(open.getAttribute("href")).toBe("/p/ai");
  });

  it("GivenNoRunners_WhenLocalRunnersOpens_ThenAddRunnerTakesFocusToTheRunnerName", async () => {
    const h = await withProject();
    await h.router.navigate({ href: "/settings/runners" });

    await screen.findByText("No runners yet.", undefined, PAGE_LOAD);
    await h.user.click(screen.getByRole("button", { name: "Add runner" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Runner name" }));
  });

  it("GivenNoTicketsOrAgentTasks_WhenDashboardsOpens_ThenOneEmptyStateWithTheBoardAndNoAxes", async () => {
    const h = await withProject();
    await h.router.navigate({ href: "/p/ai/dashboards" });

    expect(
      await screen.findByText("No tickets or agent tasks in these weeks.", undefined, PAGE_LOAD),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the board" })).toBeTruthy();
    expect(document.querySelector(".recharts-surface")).toBeNull();
  });

  it("GivenNothingMergedIn14Days_WhenWhatsNewOpens_ThenOneActionWidensTheWindow", async () => {
    const h = await withProject();
    await h.router.navigate({ href: "/p/ai/whats-new" });

    await screen.findByText("Nothing merged in the last 14 days.", undefined, PAGE_LOAD);
    await h.user.click(screen.getByRole("link", { name: "Show 90 days" }));
    await waitFor(() => expect(h.router.state.location.search).toEqual({ days: 90 }));
  });

  it("GivenAProjectWithNoMilestones_WhenRoadmapOpens_ThenTheOneActionStartsThePlan", async () => {
    const h = await withProject();
    await h.router.navigate({ href: "/p/ai/roadmap" });

    const empty = (await screen.findByText("No milestones yet", undefined, PAGE_LOAD)).closest(
      '[data-slot="empty-state"]',
    ) as HTMLElement;
    expect(
      within(empty)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Plan this project"]);
  });
});

describe("AI-378: Plan this project", () => {
  it("GivenAPlanTaskAlreadyStarted_WhenTheRoadmapReloadsAndPlanIsPressedAgain_ThenTheApiRefusesAndNoSecondTaskStarts", async () => {
    const h = renderApp("/projects", { githubConnected: true });
    await h.tracker.createProject({
      name: "Andy Intelligence",
      key: "AI",
      repos: ["albernhagen/andy-intelligence"],
    });
    await h.router.navigate({ href: "/p/ai/roadmap" });
    await h.user.click(await screen.findByRole("button", { name: "Plan this project" }, PAGE_LOAD));
    expect(await screen.findByRole("link", { name: "Agent task · plan-project" })).toBeTruthy();

    // A reload: the page forgets the started task and the button shows again.
    await h.router.navigate({ href: "/p/ai/work" });
    await h.router.navigate({ href: "/p/ai/roadmap" });
    await h.user.click(await screen.findByRole("button", { name: "Plan this project" }, PAGE_LOAD));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(await h.runs.listActive("ai")).toHaveLength(1);
  });
});
