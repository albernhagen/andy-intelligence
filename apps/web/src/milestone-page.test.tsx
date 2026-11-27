import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { PAGE_LOAD, renderApp } from "@/test/harness";
import { pick } from "@/test/pick";

/**
 * Milestone page (AI-405): `/p/<project>/m/<milestone id>` shows one milestone with its status,
 * progress, case and epics, and manages its epics with the roadmap's own writes.
 */

const AT = "2026-11-27T00:00:00.000Z";

async function seeded(path: string, opts: Parameters<typeof renderApp>[1] = {}) {
  const harness = renderApp("/", opts);
  const { tracker, milestones } = harness;
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await tracker.createProject({ name: "Ops", key: "OPS" });
  const milestone = (id: string, projectId: string, order: number, name: string) =>
    milestones.create({
      id,
      projectId,
      name,
      outcome: `${name} works`,
      order,
      status: "not_reviewed",
      createdAt: AT,
      updatedAt: AT,
    });
  await milestone("m1", "ai", 1, "M1: First flow");
  await milestone("m2", "ai", 2, "M2: Self-hosting");
  await milestone("o1", "ops", 1, "O1: Backups");
  await milestones.replace({
    ...(await milestones.get("ai", "m1"))!,
    case: { serves: "Andy", expectedReturn: "Tickets ship", cheapestTest: "One ticket" },
  });
  const epic = async (title: string, parentId: string | null = null) => {
    const t = await tracker.createTicket("ai", { title, type: "epic", parentId }, "andy");
    if (!parentId)
      await tracker.updateTicket("ai", t.id, { fields: { milestoneId: "m1" } }, "andy");
    return t;
  };
  const flow = await epic("Ticket to PR");
  const child = await epic("Refine questions", flow.id);
  const shipped = await epic("Sign in");
  await tracker.updateTicket(
    "ai",
    shipped.id,
    { stage: { to: "done", forced: true, reason: null } },
    "andy",
  );
  const story = await tracker.createTicket(
    "ai",
    { title: "Opens a PR", parentId: flow.id },
    "andy",
  );
  await tracker.updateTicket(
    "ai",
    story.id,
    { stage: { to: "done", forced: true, reason: null } },
    "andy",
  );
  await tracker.createTicket("ai", { title: "Merges a PR", parentId: child.id }, "andy");
  await harness.router.navigate({ href: path });
  return { harness, flow, child, shipped };
}

const order = () =>
  [...document.querySelectorAll("[data-milestone-page] li[data-epic]:not([data-parent-epic])")].map(
    (el) => el.getAttribute("data-epic"),
  );

describe("milestone page (AI-405)", () => {
  it("GivenAMilestone_WhenItsUrlOpens_ThenItsNameOutcomeStatusProgressAndCaseShow", async () => {
    await seeded("/p/ai/m/m1");

    expect(await screen.findByRole("heading", { name: "M1: First flow" }, PAGE_LOAD)).toBeTruthy();
    expect(screen.getByText("M1: First flow works")).toBeTruthy();
    const status = screen.getByRole("group", { name: "Status of M1: First flow" });
    expect(
      within(status).getByRole("button", { name: "Not reviewed" }).getAttribute("aria-pressed"),
    ).toBe("true");
    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getByText("1 of 2 done")).toBeTruthy();
    const kase = screen.getByRole("region", { name: "Case for M1: First flow" });
    expect(within(kase).getByText("Tickets ship")).toBeTruthy();
    expect(within(kase).getByText("2 tickets: 2 unsized")).toBeTruthy();
  });

  it("GivenEpicsInTheMilestone_WhenThePageShows_ThenEveryEpicIsListedDoneIncludedChildrenNested", async () => {
    const { harness, flow, child, shipped } = await seeded("/p/ai/m/m1");

    const link = await screen.findByRole("link", { name: new RegExp(`^${flow.key} `) }, PAGE_LOAD);
    const row = link.closest("li")!;
    expect(within(row).getByText("In progress")).toBeTruthy();
    expect(within(row).getByText("1 of 2 done")).toBeTruthy();
    const nested = within(row).getByRole("list", { name: `Child epics of ${flow.key}` });
    expect(
      within(nested).getByRole("link", { name: new RegExp(`${child.key} Refine questions`) }),
    ).toBeTruthy();
    const done = screen.getByRole("link", { name: new RegExp(`^${shipped.key} `) }).closest("li")!;
    expect(within(done).getByText("Done")).toBeTruthy();
    expect(order()).toEqual([flow.key, shipped.key]);
    await harness.user.click(link);
    await waitFor(() => expect(harness.router.state.location.pathname).toBe(`/p/ai/t/${flow.key}`));
  });

  it("GivenTheMilestonePage_WhenNewEpicIsUsed_ThenAnEpicIsCreatedInThisMilestoneAndListed", async () => {
    const { harness } = await seeded("/p/ai/m/m1");

    const title = await screen.findByRole(
      "textbox",
      { name: "New epic in M1: First flow" },
      PAGE_LOAD,
    );
    await harness.user.type(title, "Cost per ticket");
    await harness.user.click(screen.getByRole("button", { name: "New epic" }));

    expect(await screen.findByRole("link", { name: /Cost per ticket/ })).toBeTruthy();
    const created = (await harness.tracker.listTickets("ai")).find(
      (t) => t.title === "Cost per ticket",
    );
    expect(created).toMatchObject({ type: "epic", milestoneId: "m1", parentId: null });
  });

  it("GivenAttachingIsRefused_WhenNewEpicIsUsed_ThenItSaysSoAndClearsTheTitleSoNoRetryDuplicates", async () => {
    const { harness } = await seeded("/p/ai/m/m1", {
      beforeFetch: async (request) => {
        if (request.method === "PUT" && request.url.endsWith("/milestone"))
          throw new Error("network down");
      },
    });

    const title = await screen.findByRole(
      "textbox",
      { name: "New epic in M1: First flow" },
      PAGE_LOAD,
    );
    await harness.user.type(title, "Cost per ticket");
    await harness.user.click(screen.getByRole("button", { name: "New epic" }));

    expect(await screen.findByText(/was created with no milestone/)).toBeTruthy();
    expect((title as HTMLInputElement).value).toBe("");
    const created = (await harness.tracker.listTickets("ai")).filter(
      (t) => t.title === "Cost per ticket",
    );
    expect(created).toHaveLength(1);
    expect(created[0]!.milestoneId).toBeNull();
  });

  it("GivenTheMilestonePage_WhenAndyApproves_ThenTheMilestoneIsApprovedAsOnTheRoadmap", async () => {
    const { harness } = await seeded("/p/ai/m/m1");

    const status = await screen.findByRole(
      "group",
      { name: "Status of M1: First flow" },
      PAGE_LOAD,
    );
    await harness.user.click(within(status).getByRole("button", { name: "Parked" }));
    await waitFor(async () =>
      expect((await harness.milestones.get("ai", "m1"))?.status).toBe("parked"),
    );
    await harness.user.click(within(status).getByRole("button", { name: "Approved" }));
    await waitFor(async () =>
      expect((await harness.milestones.get("ai", "m1"))?.status).toBe("approved"),
    );
  });

  it("GivenTwoEpics_WhenOneIsMovedUp_ThenTheMilestoneOrderChangesAndSaves", async () => {
    const { harness, flow, shipped } = await seeded("/p/ai/m/m1");

    const up = await screen.findByRole(
      "button",
      { name: `Move ${shipped.key}: Sign in up` },
      PAGE_LOAD,
    );
    // Enabled once the project's tickets (their ranks) have loaded.
    await waitFor(() => expect((up as HTMLButtonElement).disabled).toBe(false));
    await harness.user.click(up);

    await waitFor(() => expect(order()).toEqual([shipped.key, flow.key]));
    const [a, b] = await Promise.all([
      harness.tracker.getTicket("ai", shipped.id),
      harness.tracker.getTicket("ai", flow.id),
    ]);
    expect(a!.rank < b!.rank).toBe(true);
  });

  it("GivenAnEpic_WhenMovedToAnotherMilestone_ThenItLeavesThisPageAndJoinsThatMilestone", async () => {
    const { harness, shipped } = await seeded("/p/ai/m/m1");

    await pick(
      harness.user,
      await screen.findByRole("combobox", { name: `Milestone of ${shipped.key}` }, PAGE_LOAD),
      /M2: Self-hosting/,
    );

    await waitFor(async () =>
      expect((await harness.tracker.getTicket("ai", shipped.id))?.milestoneId).toBe("m2"),
    );
    await waitFor(() => expect(order()).not.toContain(shipped.key));
  });

  it("GivenATopLevelEpic_WhenDraftTicketsIsOpened_ThenTheEpicPanelsBreakdownShows", async () => {
    const { harness, flow } = await seeded("/p/ai/m/m1");

    const row = (
      await screen.findByRole("link", { name: new RegExp(`^${flow.key} `) }, PAGE_LOAD)
    ).closest("li")!;
    await harness.user.click(await within(row).findByRole("button", { name: "Draft tickets" }));

    const breakdown = await within(row).findByRole("region", { name: "Breakdown" });
    // M1 is not reviewed, so drafting waits, as on the epic panel.
    expect(within(breakdown).getByText(/approve it on the roadmap first/)).toBeTruthy();
  });

  it("GivenAnOpenQuestionOnATicketInTheMilestone_WhenThePageShows_ThenNeedsYouLinksToIt", async () => {
    const { harness, child } = await seeded("/p/ai/m/m1");
    const merges = (await harness.tracker.listTickets("ai")).find(
      (t) => t.title === "Merges a PR",
    )!;
    await harness.tracker.askQuestion("ai", merges.id, { text: "Squash or merge?" }, "andy");
    await harness.router.navigate({ href: "/p/ai/m/m2" });
    await harness.router.navigate({ href: "/p/ai/m/m1" });

    const needs = await screen.findByRole("region", { name: "Needs you" }, PAGE_LOAD);
    const link = await within(needs).findByRole("link", { name: new RegExp(`^${merges.key} `) });
    expect(within(link.closest("li")!).getByText("1 question")).toBeTruthy();
    expect(child.key).toBeTruthy();
  });

  it("GivenTheRoadmap_WhenShown_ThenEachMilestoneRowLinksToItsPage", async () => {
    const { harness } = await seeded("/p/ai/roadmap");

    const open = await screen.findByRole("link", { name: "Open M2: Self-hosting" }, PAGE_LOAD);
    expect(open.getAttribute("href")).toBe("/p/ai/m/m2");
    await harness.user.click(open);
    expect(await screen.findByRole("heading", { name: "M2: Self-hosting" })).toBeTruthy();
  });

  it("GivenAnUnknownOrOtherProjectsMilestone_WhenItsUrlOpens_ThenThePageIsNotFound", async () => {
    const { harness } = await seeded("/p/ai/m/nope");

    expect(await screen.findByText("Page not found.", undefined, PAGE_LOAD)).toBeTruthy();
    await harness.router.navigate({ href: "/p/ai/m/o1" });
    expect(await screen.findByText("Page not found.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "O1: Backups" })).toBeNull();
  });
});
