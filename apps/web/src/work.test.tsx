import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** Work across projects (AI-198): one fixed view's open tickets, grouped by project. */
async function seeded(path: string) {
  const harness = renderApp();
  const { service, tracker } = harness;
  await tracker.createProject({ name: "Ops", key: "OPS" });
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  const asked = await service.create("ai", { title: "Pick a lane" }, "andy");
  await service.setWorker("ai", asked.id, "agent", "andy");
  await service.ask("ai", asked.id, { text: "Which lane?" }, "andy");
  const blocked = await service.create(
    "ai",
    { title: "Waits on the lane", blockedBy: [asked.key] },
    "andy",
  );
  await service.setWorker("ai", blocked.id, "agent", "andy");
  const flagged = await service.create("ops", { title: "Rotate the key" }, "andy");
  await service.setWorker("ops", flagged.id, "agent", "andy");
  await service.ask("ops", flagged.id, { text: "Which key?" }, "andy");
  await harness.router.navigate({ href: path });
  await screen.findByRole("group", { name: "Work view" });
  return harness;
}

const rows = () =>
  [...document.querySelectorAll("li[data-ticket]")].map((el) => el.getAttribute("data-ticket"));
const chip = (name: RegExp) => screen.getByRole("button", { name });

describe("work across projects", () => {
  it("GivenTwoProjects_WhenWorkOpensUnderAllProjects_ThenNeedsMeIsListedByProject", async () => {
    await seeded("/all/work");

    expect(chip(/^Needs me 2$/).getAttribute("aria-pressed")).toBe("true");
    expect(
      within(screen.getByRole("group", { name: "Work view" })).queryByRole("button", {
        name: /^All/,
      }),
    ).toBeNull();
    const ai = await screen.findByRole("region", { name: "Andy Intelligence" });
    expect(within(ai).getByRole("heading").textContent).toBe("Andy Intelligence 1");
    expect(within(ai).getByRole("link", { name: "Pick a lane" })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Ops" })).getByText("1 question"),
    ).toBeTruthy();
    expect(rows()).toEqual(["AI-1", "OPS-1"]);
  });

  it("GivenTheList_WhenAnotherChipIsPicked_ThenTheListAndTheUrlChange", async () => {
    const harness = await seeded("/all/work");
    await waitFor(() => expect(rows()).toHaveLength(2));

    await harness.user.click(chip(/^Blocked/));

    await waitFor(() => expect(rows()).toEqual(["AI-2"]));
    expect(harness.router.state.location.search).toEqual({ view: "blocked" });
    expect(screen.getByText("Blocked by AI-1")).toBeTruthy();
  });

  it("GivenOneProject_WhenItsWorkOpens_ThenOnlyItsTicketsShowWithoutAHeading", async () => {
    await seeded("/p/ops/work?view=needs-me");

    await waitFor(() => expect(rows()).toEqual(["OPS-1"]));
    expect(screen.queryByRole("heading", { name: /^Ops/ })).toBeNull();
  });

  it("GivenARow_WhenItsTitleIsClicked_ThenTheTicketOpensInItsProject", async () => {
    const harness = await seeded("/all/work");

    await harness.user.click(await screen.findByRole("link", { name: "Rotate the key" }));

    await waitFor(() => expect(harness.router.state.location.pathname).toBe("/p/ops/t/OPS-1"));
  });

  it("GivenAnEmptyView_WhenPicked_ThenItSaysSo", async () => {
    await seeded("/all/work?view=mine");

    expect(await screen.findByText("Nothing in Mine.")).toBeTruthy();
  });

  it("GivenAProjectScope_WhenTheHeaderShows_ThenWorkLinksToThatProjectsList", async () => {
    await seeded("/p/ai/work");

    const link = await screen.findByRole("link", { name: "Work" });
    expect(link.getAttribute("href")).toBe("/p/ai/work");
    expect(link.getAttribute("aria-current")).toBe("page");
  });
});
