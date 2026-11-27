import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { InMemoryWorkTracker, type Stage } from "@andy/contracts";
import { syncEpicStages } from "@andy/domain";
import { PAGE_LOAD, renderApp } from "@/test/harness";

/**
 * Roadmap (AI-202: M4.26): milestones in order with status and progress, expanding to their
 * epics; parked ones dimmed, done ones compact, epics with no milestone last.
 */

/** No write path sets an epic's milestone before AI-304, so this tracker reports it by key. */
function trackerWithMilestones(milestoneOfKey: ReadonlyMap<string, string>) {
  return new Proxy(new InMemoryWorkTracker(), {
    get(target, prop, receiver) {
      if (prop === "listTickets") {
        return async (...args: Parameters<InMemoryWorkTracker["listTickets"]>) =>
          (await target.listTickets(...args)).map((t) => ({
            ...t,
            milestoneId: milestoneOfKey.get(t.key) ?? null,
          }));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function seeded(
  path: string,
  extra?: (h: ReturnType<typeof renderApp>, epics: { hosting: { id: string } }) => Promise<void>,
) {
  const milestoneOfKey = new Map<string, string>();
  const harness = renderApp("/", { tracker: trackerWithMilestones(milestoneOfKey) });
  const { tracker, milestones } = harness;
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await tracker.createProject({ name: "Ops", key: "OPS" });
  const milestone = (id: string, order: number, name: string, status: string) =>
    milestones.create({
      id,
      projectId: "ai",
      name,
      outcome: `${name} works`,
      order,
      status: status as "approved" | "parked" | "not_reviewed",
      createdAt: "2026-11-21T00:00:00.000Z",
      updatedAt: "2026-11-21T00:00:00.000Z",
    });
  await milestone("m3", 3, "M3: Mobile", "parked");
  await milestone("m1", 1, "M1: First flow", "approved");
  await milestone("m2", 2, "M2: Self-hosting", "not_reviewed");
  // Written as the app writes (ADR-0164): each epic's stage follows its tickets.
  const synced = syncEpicStages(tracker);
  const epic = (title: string) => synced.createTicket("ai", { title, type: "epic" }, "andy");
  const at = (id: string, to: Stage) =>
    synced.updateTicket("ai", id, { stage: { to, forced: true, reason: null } }, "andy");
  const done = await epic("First flow");
  const hosting = await epic("Builds itself");
  const mobile = await epic("Phone app");
  const loose = await epic("Parallel work");
  const shipped = await synced.createTicket("ai", { title: "Shipped", parentId: done.id }, "andy");
  await at(shipped.id, "done");
  const child = await synced.createTicket(
    "ai",
    { title: "Runs a PR", parentId: hosting.id },
    "andy",
  );
  await at(child.id, "ready_for_review");
  await synced.createTicket("ai", { title: "Merges a PR", parentId: hosting.id }, "andy");
  milestoneOfKey.set(done.key, "m1");
  milestoneOfKey.set(hosting.key, "m2");
  milestoneOfKey.set(mobile.key, "m3");
  await extra?.(harness, { hosting });
  await harness.router.navigate({ href: path });
  await screen.findByRole("heading", { name: "Roadmap" }, PAGE_LOAD);
  return { harness, done, hosting, mobile, loose };
}

const milestoneRows = () =>
  [...document.querySelectorAll("li[data-milestone]")].map((el) => [
    el.getAttribute("data-milestone"),
    el.getAttribute("data-status"),
  ]);
const row = (name: RegExp) => screen.getByRole("button", { name });

describe("roadmap", () => {
  it("GivenMilestones_WhenRoadmapOpens_ThenOneRowEachInOrderWithStatusAndProgress", async () => {
    await seeded("/p/ai/roadmap");

    await waitFor(() =>
      expect(milestoneRows()).toEqual([
        ["m1", "done"],
        ["m2", "not_reviewed"],
        ["m3", "parked"],
      ]),
    );
    const hosting = row(/^M2: Self-hosting/);
    const status = screen.getByRole("group", { name: "Status of M2: Self-hosting" });
    expect(
      within(status).getByRole("button", { name: "Not reviewed" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(within(hosting).getByText("0 of 2 done")).toBeTruthy();
    expect(within(hosting).getByText("1 in review")).toBeTruthy();
    expect(within(row(/^M1: First flow/)).getByText("Done")).toBeTruthy();
  });

  it("GivenAParkedMilestone_WhenShown_ThenItsRowIsDimmed", async () => {
    await seeded("/p/ai/roadmap");

    const parked = (await screen.findByText("M3: Mobile")).closest("li")!;
    expect(parked.className).toContain("opacity-60");
    expect(within(parked).getByText("Parked")).toBeTruthy();
  });

  it("GivenAMilestone_WhenExpanded_ThenItsEpicsShowWithProgressAndOpenTheEpic", async () => {
    const { harness, hosting } = await seeded("/p/ai/roadmap");

    await harness.user.click(await screen.findByRole("button", { name: /^M2: Self-hosting/ }));

    const epic = await screen.findByRole("link", { name: new RegExp(hosting.key) });
    const item = epic.closest("li")!;
    expect(within(item).getByText("In progress")).toBeTruthy();
    expect(within(item).getByText("0 of 2 done")).toBeTruthy();
    await harness.user.click(epic);
    await waitFor(() =>
      expect(harness.router.state.location.pathname).toBe(`/p/ai/t/${hosting.key}`),
    );
  });

  it("GivenAnEpicWithNoMilestone_WhenShown_ThenItIsUnderNoMilestone", async () => {
    const { loose } = await seeded("/p/ai/roadmap");

    const section = await screen.findByRole("region", { name: "No milestone" });
    expect(within(section).getByRole("link", { name: new RegExp(loose.key) })).toBeTruthy();
  });

  it("GivenAllProjects_WhenRoadmapOpens_ThenEachProjectHasItsHeading", async () => {
    await seeded("/all/roadmap");

    expect(await screen.findByRole("region", { name: "Andy Intelligence" })).toBeTruthy();
    const ops = screen.getByRole("region", { name: "Ops" });
    expect(within(ops).getByText("No milestones yet")).toBeTruthy();
    expect(within(ops).getByRole("button", { name: "Plan this project" })).toBeTruthy();
  });

  it("GivenTheShell_WhenAProjectIsOpen_ThenRoadmapIsLinked", async () => {
    await seeded("/p/ai/roadmap");

    const link = screen.getAllByRole("link", { name: "Roadmap" })[0]!;
    expect(link.getAttribute("href")).toBe("/p/ai/roadmap");
  });
});

describe("roadmap milestone case (ADR-0149, AI-365)", () => {
  const CASE = {
    serves: "Andy, deciding what to build",
    expectedReturn: "He decides in a minute.",
    cheapestTest: "Ask him with one case.",
  };

  it("GivenANotReviewedMilestoneWithNoCase_WhenOpened_ThenItSaysSoAndAndyCanStillApprove", async () => {
    const { harness } = await seeded("/p/ai/roadmap");

    await harness.user.click(await screen.findByRole("button", { name: /^M2: Self-hosting/ }));

    const kase = await screen.findByRole("region", { name: "Case for M2: Self-hosting" });
    expect(within(kase).getByText("No case written yet. You can still approve it.")).toBeTruthy();
    expect(within(kase).getByText("2 tickets: 2 unsized")).toBeTruthy();
    await harness.user.click(
      within(screen.getByRole("group", { name: "Status of M2: Self-hosting" })).getByRole(
        "button",
        { name: "Approved" },
      ),
    );
    await waitFor(async () =>
      expect((await harness.milestones.get("ai", "m2"))?.status).toBe("approved"),
    );
  });

  it("GivenANotReviewedMilestone_WhenTheOwnerWritesItsCase_ThenItIsShownSavedAndLogged", async () => {
    const { harness } = await seeded("/p/ai/roadmap");
    await harness.user.click(await screen.findByRole("button", { name: /^M2: Self-hosting/ }));
    const kase = await screen.findByRole("region", { name: "Case for M2: Self-hosting" });

    await harness.user.click(within(kase).getByRole("button", { name: "Write case" }));
    await harness.user.type(within(kase).getByRole("textbox", { name: "Serves" }), CASE.serves);
    await harness.user.type(
      within(kase).getByRole("textbox", { name: "Expected return" }),
      CASE.expectedReturn,
    );
    await harness.user.type(
      within(kase).getByRole("textbox", { name: "Cheapest test" }),
      CASE.cheapestTest,
    );
    await harness.user.click(within(kase).getByRole("button", { name: "Save case" }));

    await waitFor(async () =>
      expect((await harness.milestones.get("ai", "m2"))?.case).toEqual(CASE),
    );
    expect(await within(kase).findByText(CASE.expectedReturn)).toBeTruthy();
    const log = await harness.configChanges.listForProject("ai");
    expect(log.find((c) => c.entity === "milestone" && "case" in c.diff)?.diff).toEqual({
      case: { from: null, to: CASE },
    });
  });

  it("GivenAnApprovedMilestoneWithoutACase_WhenOpened_ThenNoCaseBlockShows", async () => {
    const { harness } = await seeded("/p/ai/roadmap");

    await harness.user.click(await screen.findByRole("button", { name: /^M1: First flow/ }));

    await screen.findByRole("group", { name: "Status of M1: First flow" });
    expect(screen.queryByRole("region", { name: "Case for M1: First flow" })).toBeNull();
  });
});

/** AI-403: every epic is listed under its milestone, since the board shows epics only as headers. */
describe("every epic on the roadmap", () => {
  const epicRow = (key: string) => document.querySelector<HTMLElement>(`li[data-epic="${key}"]`);

  it("GivenADoneEpic_WhenItsMilestoneOpens_ThenItIsListedWithStateProgressAndALinkToItsPanel", async () => {
    const { harness, done } = await seeded("/p/ai/roadmap");

    await harness.user.click(await screen.findByRole("button", { name: /^M1: First flow/ }));

    const item = await waitFor(() => epicRow(done.key)!);
    expect(within(item).getByText("Done")).toBeTruthy();
    expect(within(item).getByText("1 of 1 done")).toBeTruthy();
    await harness.user.click(within(item).getByRole("link", { name: new RegExp(done.key) }));
    await waitFor(() => expect(harness.router.state.location.pathname).toBe(`/p/ai/t/${done.key}`));
  });

  it("GivenAnEpicWithNoTickets_WhenItsMilestoneOpens_ThenItIsStillListedAsNotStarted", async () => {
    const { harness, mobile } = await seeded("/p/ai/roadmap");

    await harness.user.click(await screen.findByRole("button", { name: /^M3: Mobile/ }));

    const item = await waitFor(() => epicRow(mobile.key)!);
    expect(within(item).getByText("Phone app")).toBeTruthy();
    expect(within(item).getByText("Not started")).toBeTruthy();
    expect(within(item).getByText("0 of 0 done")).toBeTruthy();
  });

  it("GivenAnEpicWithNoMilestoneAndNoTickets_WhenTheRoadmapShows_ThenItIsInTheNoMilestoneGroup", async () => {
    const { loose } = await seeded("/p/ai/roadmap");

    const section = await screen.findByRole("region", { name: "No milestone" });
    const item = within(section)
      .getByRole("link", { name: new RegExp(loose.key) })
      .closest("li")!;
    expect(within(item).getByText("Not started")).toBeTruthy();
  });

  it("GivenAChildEpic_WhenItsParentsMilestoneOpens_ThenItIsListedUnderItsParentWithALink", async () => {
    let childKey = "";
    const { harness, hosting } = await seeded("/p/ai/roadmap", async ({ tracker }, epics) => {
      const child = await tracker.createTicket(
        "ai",
        { title: "Runner pool", type: "epic", parentId: epics.hosting.id },
        "andy",
      );
      childKey = child.key;
    });

    await harness.user.click(await screen.findByRole("button", { name: /^M2: Self-hosting/ }));

    const item = await waitFor(() => epicRow(childKey)!);
    expect(item.getAttribute("data-parent-epic")).toBe(hosting.key);
    expect(epicRow(hosting.key)!.nextElementSibling).toBe(item);
    expect(within(item).getByText("Not started")).toBeTruthy();
    await harness.user.click(within(item).getByRole("link", { name: new RegExp(childKey) }));
    await waitFor(() => expect(harness.router.state.location.pathname).toBe(`/p/ai/t/${childKey}`));
  });
});
