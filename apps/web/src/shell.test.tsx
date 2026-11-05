import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

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
  it("GivenItemsInTwoProjects_WhenAnyScreenIsOpen_ThenTheHeaderCountsAllOfThem", async () => {
    const harness = await twoProjects("/p/ai");
    expect(await screen.findByRole("link", { name: "Needs you 2" })).toBeTruthy();
    expect(pathname(harness)).toBe("/p/ai");
  });

  it("GivenAllProjects_WhenTheInboxOpens_ThenItListsEveryProjectsQuestions", async () => {
    await twoProjects("/all/inbox");
    expect(await screen.findByRole("article", { name: "Question: Which colour?" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Question: Daily?" })).toBeTruthy();
  });

  it("GivenAProjectScope_WhenTheInboxOpens_ThenItListsOnlyThatProject", async () => {
    await twoProjects("/p/ops/inbox");
    expect(await screen.findByRole("article", { name: "Question: Daily?" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Question: Which colour?" })).toBeNull();
  });

  it("GivenThePicker_WhenAndyPicksAProject_ThenTheSameScreenShowsThatProject", async () => {
    const harness = await twoProjects("/all/inbox");
    const { user } = harness;
    await user.click(await screen.findByRole("button", { name: /All projects/ }));
    const menu = await screen.findByRole("menu");
    const ops = within(menu).getByRole("menuitem", { name: /Ops/ });
    expect(within(ops).getByLabelText("1 waiting on you")).toBeTruthy();
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
    await harness.user.click(await screen.findByRole("link", { name: "Settings" }));
    await waitFor(() => expect(pathname(harness)).toBe("/settings/github"));
    expect(await screen.findByRole("button", { name: /AI Andy Intelligence/ })).toBeTruthy();
  });

  it("GivenAllProjects_WhenTheBoardOpens_ThenItAsksForAProject", async () => {
    await twoProjects("/all/board");
    expect(await screen.findByText("A board shows one project. Pick one:")).toBeTruthy();
    expect(screen.getByRole("link", { name: "OPS Ops" }).getAttribute("href")).toBe("/p/ops");
  });
});
