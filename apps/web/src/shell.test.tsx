import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";
import { stubResizeObserver } from "@/test/resize-observer";

// Models renders Radix Switch, which needs ResizeObserver (AI-376).
stubResizeObserver();

/** AI-26: the app shell and the project picker as the global scope (ADR-0059). */

async function twoProjects(path = "/all/inbox") {
  const harness = renderApp(path);
  await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await harness.tracker.createProject({ name: "Ops", key: "OPS" });
  const ai = await harness.service.create("ai", { type: "feature", title: "Shell" }, "andy");
  await harness.service.ask("ai", ai.id, { text: "Which colour?" }, "andy");
  const ops = await harness.service.create("ops", { type: "chore", title: "Backups" }, "andy");
  await harness.service.ask("ops", ops.id, { text: "Daily?" }, "andy");
  await harness.router.invalidate();
  return harness;
}

const pathname = (h: { router: { state: { location: { pathname: string } } } }) =>
  h.router.state.location.pathname;

describe("app shell", () => {
  it("GivenTheDesktopShell_WhenItRenders_ThenTheSidebarOpensWithTheMarkAndProductName", async () => {
    await twoProjects("/p/ai");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const sidebar = nav.closest("aside")!;

    const brand = sidebar.firstElementChild!;
    expect(brand.textContent).toBe("andy-intelligence");
    expect(brand.querySelector("svg[data-logo]")).toBeTruthy();
  });

  it("GivenItemsInTwoProjects_WhenAProjectScreenIsOpen_ThenTheSidebarCountsEachProject", async () => {
    const harness = await twoProjects("/p/ai");
    const main = await screen.findByRole("navigation", { name: "Main" });
    expect(
      await within(main).findByRole("link", { name: "Inbox 1 ticket waiting on you" }),
    ).toBeTruthy();
    const projects = screen.getByRole("navigation", { name: "Projects" });
    expect(
      within(projects)
        .getByRole("link", { name: "Ops 1 ticket waiting on you" })
        .getAttribute("href"),
    ).toBe("/p/ops");
    expect(pathname(harness)).toBe("/p/ai");
  });

  it("GivenItemsInTwoProjects_WhenAllProjectsIsOpen_ThenTheInboxCountsAllOfThem", async () => {
    await twoProjects("/all/work");
    expect(
      await screen.findByRole("link", { name: "Inbox 2 tickets waiting on you" }),
    ).toBeTruthy();
  });

  it("GivenAllProjects_WhenTheInboxOpens_ThenItListsEveryProjectsQuestions", async () => {
    await twoProjects("/all/inbox");
    // AI-371: a row per ticket, each saying its question; the first one's question beside them.
    expect(await screen.findByRole("button", { name: "AI-1: Shell" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "OPS-1: Backups" }).textContent).toContain("Daily?");
    expect(screen.getByRole("listitem", { name: "Question: Which colour?" })).toBeTruthy();
  });

  it("GivenAProjectScope_WhenTheInboxOpens_ThenItListsOnlyThatProject", async () => {
    await twoProjects("/p/ops/inbox");
    expect(await screen.findByRole("listitem", { name: "Question: Daily?" })).toBeTruthy();
    expect(screen.queryByRole("listitem", { name: "Question: Which colour?" })).toBeNull();
  });

  it("GivenThePicker_WhenAndyPicksAProject_ThenTheSameScreenShowsThatProject", async () => {
    const harness = await twoProjects("/all/inbox");
    const { user } = harness;
    await user.click(await screen.findByRole("button", { name: /All projects/ }));
    const menu = await screen.findByRole("menu");
    const ops = within(menu).getByRole("menuitem", { name: /Ops/ });
    expect(within(ops).getByLabelText("1 ticket waiting on you")).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /Add project/ })).toBeTruthy();

    await user.click(ops);
    await waitFor(() => expect(pathname(harness)).toBe("/p/ops/inbox"));
    expect(screen.getByRole("button", { name: /OPS Ops/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Board" }).getAttribute("href")).toBe("/p/ops");
  });

  it("GivenAProjectWasLastUsed_WhenAndyOpensHome_ThenItsInboxOpens", async () => {
    window.localStorage.setItem("andy.scope", "p:ops");
    const harness = await twoProjects("/");
    await waitFor(() => expect(pathname(harness)).toBe("/p/ops/inbox"));
  });

  it("GivenNothingRemembered_WhenAndyOpensHome_ThenTheAllProjectsInboxOpens", async () => {
    const harness = await twoProjects("/");
    await waitFor(() => expect(pathname(harness)).toBe("/all/inbox"));
  });

  it("GivenAProjectScreen_WhenAndyOpensSettings_ThenThePickerStillShowsThatProject", async () => {
    const harness = await twoProjects("/p/ai");
    await harness.user.click(await screen.findByRole("button", { name: "Settings" }));
    await harness.user.click(await screen.findByRole("menuitem", { name: "GitHub" }));
    await waitFor(() => expect(pathname(harness)).toBe("/settings/github"));
    expect(await screen.findByRole("button", { name: /AI Andy Intelligence/ })).toBeTruthy();
  });

  it("GivenAProject_WhenTheHeaderRenders_ThenItShowsSixDestinationsInboxFirst", async () => {
    await twoProjects("/p/ai/inbox");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((l) => l.textContent);
    expect(labels).toEqual(["Inbox", "Board", "Roadmap", "Work", "Dashboards", "What's new"]);
    expect(within(nav).getByRole("link", { name: "What's new" }).getAttribute("href")).toBe(
      "/p/ai/whats-new",
    );
  });

  it("GivenAllProjects_WhenTheHeaderRenders_ThenWhatsNewIsLeftOut", async () => {
    await twoProjects("/all/inbox");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((l) => l.textContent);
    expect(labels).toEqual(["Inbox", "Board", "Roadmap", "Work", "Dashboards"]);
  });

  it("GivenAProject_WhenAndyOpensTheSettingsMenu_ThenItListsEverySettingsPage", async () => {
    const harness = await twoProjects("/p/ops");
    await harness.user.click(await screen.findByRole("button", { name: "Settings" }));
    const items = within(await screen.findByRole("menu"))
      .getAllByRole("menuitem")
      .map((i) => i.textContent);
    expect(items).toEqual(["Project settings", "GitHub", "Local runners", "Models"]);
    await harness.user.click(screen.getByRole("menuitem", { name: "Project settings" }));
    await waitFor(() => expect(pathname(harness)).toBe("/p/ops/settings"));
  });

  it("GivenASettingsPage_WhenItOpens_ThenTabsLeadToTheOtherSettingsPages", async () => {
    window.localStorage.setItem("andy.scope", "p:ops");
    const harness = await twoProjects("/settings/models");
    const tabs = await screen
      .findByRole("main")
      .then((m) => within(m).findByRole("navigation", { name: "Settings pages" }));
    expect(within(tabs).getByRole("link", { name: "Models" }).getAttribute("aria-current")).toBe(
      "page",
    );
    await harness.user.click(within(tabs).getByRole("link", { name: "Project settings" }));
    await waitFor(() => expect(pathname(harness)).toBe("/p/ops/settings"));
    expect(await screen.findByText("OPS: Ops settings")).toBeTruthy();
  });

  it("GivenAllProjects_WhenTheBoardOpens_ThenItAsksForAProject", async () => {
    await twoProjects("/all/board");
    expect(await screen.findByText("A board shows one project. Pick one:")).toBeTruthy();
    // The project links come from their own query, after the heading.
    expect((await screen.findByRole("link", { name: "OPS Ops" })).getAttribute("href")).toBe(
      "/p/ops",
    );
  });
});
