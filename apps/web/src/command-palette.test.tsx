import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";
import { SHORTCUTS } from "@/lib/shortcuts";

/** AI-370: the command palette (Cmd+K, Ctrl+K elsewhere) and the sidebar by keyboard. */

async function project(path = "/p/ai/inbox") {
  const harness = renderApp(path);
  await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await harness.service.create("ai", { type: "feature", title: "Rotate runner secrets" }, "andy");
  await harness.service.create("ai", { type: "chore", title: "Design source" }, "andy");
  await harness.router.invalidate();
  await screen.findByRole("navigation", { name: "Main" });
  return harness;
}

const pathname = (h: { router: { state: { location: { pathname: string } } } }) =>
  h.router.state.location.pathname;
const palette = () => screen.findByRole("dialog", { name: "Search and commands" });
const search = () => screen.getByRole("combobox", { name: "Search tickets and commands" });

describe("command palette", () => {
  it("GivenAnyScreen_WhenAndyPressesCmdK_ThenThePaletteOpensWithTheSearchFocused", async () => {
    const h = await project();
    await h.user.keyboard("{Meta>}k{/Meta}");
    await palette();
    expect(document.activeElement).toBe(search());
  });

  it("GivenAnyScreen_WhenAndyPressesCtrlK_ThenThePaletteOpens", async () => {
    const h = await project();
    await h.user.keyboard("{Control>}k{/Control}");
    expect(await palette()).toBeTruthy();
  });

  it("GivenATicketKey_WhenAndySearchesAndPressesEnter_ThenThatTicketOpens", async () => {
    const h = await project();
    await h.user.keyboard("{Meta>}k{/Meta}");
    await palette();
    await h.user.type(search(), "AI-2");
    const tickets = await screen.findByRole("group", { name: "Tickets" });
    expect(within(tickets).getAllByRole("option")[0]?.textContent).toContain("Design source");
    await h.user.keyboard("{Enter}");
    await waitFor(() => expect(pathname(h)).toBe("/p/ai/t/AI-2"));
    expect(screen.queryByRole("dialog", { name: "Search and commands" })).toBeNull();
  });

  it("GivenTitleWords_WhenAndySearches_ThenTheTicketIsFoundAndAClickOpensIt", async () => {
    const h = await project();
    await h.user.keyboard("{Meta>}k{/Meta}");
    await palette();
    await h.user.type(search(), "runner sec");
    const tickets = await screen.findByRole("group", { name: "Tickets" });
    const [first] = within(tickets).getAllByRole("option");
    expect(first?.textContent).toContain("AI-1");
    await h.user.click(first!);
    await waitFor(() => expect(pathname(h)).toBe("/p/ai/t/AI-1"));
  });

  it("GivenAShortcutAction_WhenAndyRunsItFromThePalette_ThenItRuns", async () => {
    const h = await project();
    await h.user.keyboard("{Meta>}k{/Meta}");
    await palette();
    await h.user.type(search(), "roadmap");
    const actions = await screen.findByRole("group", { name: "Actions" });
    expect(within(actions).getByRole("option", { name: /Go to the roadmap/ })).toBeTruthy();
    await h.user.keyboard("{Enter}");
    await waitFor(() => expect(pathname(h)).toBe("/p/ai/roadmap"));
  });

  it("GivenThePalette_WhenAndyRunsShowShortcuts_ThenTheShortcutListOpens", async () => {
    const h = await project();
    await h.user.keyboard("{Meta>}k{/Meta}");
    await palette();
    await h.user.type(search(), "show these");
    await h.user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
  });

  it("GivenThePalette_WhenItOpens_ThenEveryShortcutWithACommandIsListed", async () => {
    const h = await project();
    await h.user.keyboard("{Meta>}k{/Meta}");
    await palette();
    const actions = await screen.findByRole("group", { name: "Actions" });
    for (const s of SHORTCUTS.filter((x) => x.command))
      expect(
        within(actions).getByRole("option", { name: new RegExp(s.does.slice(0, 20)) }),
      ).toBeTruthy();
  });

  it("GivenThePaletteOpenedFromTheSidebar_WhenAndyPressesEsc_ThenItClosesAndFocusReturns", async () => {
    const h = await project();
    const button = screen.getByRole("button", { name: /Search and commands/ });
    await h.user.click(button);
    await palette();
    await h.user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Search and commands" })).toBeNull(),
    );
    expect(document.activeElement).toBe(button);
  });

  it("GivenArrowKeys_WhenAndyMovesThroughResults_ThenTheSelectionFollows", async () => {
    const h = await project();
    await h.user.keyboard("{Meta>}k{/Meta}");
    await palette();
    const options = () => screen.getAllByRole("option");
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    await h.user.keyboard("{ArrowDown}");
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(search().getAttribute("aria-activedescendant")).toBe(options()[1]?.id);
    await h.user.keyboard("{ArrowUp}{ArrowUp}");
    expect(options().at(-1)?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("sidebar by keyboard", () => {
  it("GivenTheSidebar_WhenAndyTabsThroughIt_ThenEveryDestinationIsReachedInOrderAndEnterOpensIt", async () => {
    const h = await project("/p/ai/inbox");
    const nav = screen.getByRole("navigation", { name: "Main" });
    const expected = within(nav)
      .getAllByRole("link")
      .map((l) => l.textContent);
    const reached: string[] = [];
    for (let i = 0; i < 12 && reached.length < expected.length; i++) {
      await h.user.tab();
      const el = document.activeElement as HTMLElement;
      if (nav.contains(el)) reached.push(el.textContent ?? "");
    }
    expect(reached).toEqual(expected);
    // Shift+Tab back to Roadmap, then Enter.
    for (let i = expected.length - 1; i > expected.indexOf("Roadmap"); i--)
      await h.user.tab({ shift: true });
    expect(document.activeElement?.textContent).toBe("Roadmap");
    await h.user.keyboard("{Enter}");
    await waitFor(() => expect(pathname(h)).toBe("/p/ai/roadmap"));
  });

  it("GivenTheSidebar_WhenAndyTabsPastTheProjects_ThenTheSearchAndSettingsButtonsAreReached", async () => {
    const h = await project("/p/ai/inbox");
    const names: string[] = [];
    for (let i = 0; i < 20; i++) {
      await h.user.tab();
      names.push(
        document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.textContent ??
          "",
      );
    }
    expect(names.some((n) => n.includes("Search and commands"))).toBe(true);
    expect(names).toContain("Settings");
  });
});
