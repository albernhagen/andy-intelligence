import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { MilestoneStatus } from "@andy/contracts";
import { PAGE_LOAD, readyStory, renderApp } from "@/test/harness";
import { pick } from "@/test/pick";

/**
 * AI-311: M4.38: the epic panel and the board's epic groups show the epic's milestone and its
 * status; the owner sets a milestone's status from the roadmap and the epic panel, and attaches
 * a top-level epic; a held ticket's status line says why (ADR-0131).
 */

const AT = "2026-11-21T00:00:00.000Z";

async function seeded() {
  const harness = renderApp();
  const { tracker, milestones, service } = harness;
  await tracker.createProject({ name: "AI", key: "AI" });
  const milestone = (id: string, order: number, name: string, status: MilestoneStatus) =>
    milestones.create({
      id,
      projectId: "ai",
      name,
      outcome: `${name} works`,
      order,
      status,
      createdAt: AT,
      updatedAt: AT,
    });
  await milestone("m4", 4, "M4: Epics", "approved");
  await milestone("m6", 6, "M6: Dev → prod releases", "parked");
  // AI-1 (top-level, in M6) holds AI-2 (child epic), which holds AI-3 (Ready). AI-4 is loose.
  const epic = await service.create("ai", { type: "epic", title: "Releases" }, "andy");
  await tracker.updateTicket("ai", epic.id, { fields: { milestoneId: "m6" } }, "andy");
  const child = await service.create(
    "ai",
    { type: "epic", title: "Promote", parentId: epic.id },
    "andy",
  );
  const story = await service.create(
    "ai",
    { ...readyStory, title: "Promote a build", parentId: child.id },
    "andy",
  );
  await service.move("ai", story.id, "ready", "andy");
  const loose = await service.create("ai", { type: "epic", title: "Loose ends" }, "andy");
  return { harness, epic, child, story, loose };
}

const chip = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-milestone-status]");

describe("milestone on the epic panel (AI-311)", () => {
  it("GivenATopLevelEpicInAParkedMilestone_WhenItsPanelOpens_ThenTheChipShowsNameAndStatus", async () => {
    const { harness, epic } = await seeded();

    await harness.router.navigate({ to: `/p/ai/t/${epic.key}` });

    const section = await screen.findByRole("region", { name: "Milestone" }, PAGE_LOAD);
    await waitFor(() =>
      expect(chip(section)?.textContent).toBe("M6: Dev → prod releases · Parked"),
    );
    expect(within(section).getByRole("combobox", { name: "Milestone" })).toBeTruthy();
  });

  it("GivenAChildEpic_WhenItsPanelOpens_ThenItShowsItsTopLevelEpicsMilestoneWithoutAPicker", async () => {
    const { harness, epic, child } = await seeded();

    await harness.router.navigate({ to: `/p/ai/t/${child.key}` });

    const section = await screen.findByRole("region", { name: "Milestone" }, PAGE_LOAD);
    await within(section).findByText(`from ${epic.key}`);
    expect(chip(section)?.getAttribute("data-milestone-status")).toBe("parked");
    expect(within(section).queryByRole("combobox")).toBeNull();
  });

  it("GivenALooseEpic_WhenTheOwnerPicksAMilestone_ThenItIsAttachedAndLogged", async () => {
    const { harness, loose } = await seeded();
    await harness.router.navigate({ to: `/p/ai/t/${loose.key}` });
    const section = await screen.findByRole("region", { name: "Milestone" }, PAGE_LOAD);

    await pick(
      harness.user,
      await within(section).findByRole("combobox", { name: "Milestone" }),
      "M4: Epics",
    );

    await waitFor(async () =>
      expect((await harness.tracker.getTicket("ai", loose.id))?.milestoneId).toBe("m4"),
    );
    await waitFor(() => expect(chip(section)?.textContent).toBe("M4: Epics · Approved"));
    const log = await harness.configChanges.listForProject("ai");
    expect(log.some((c) => c.entity === "milestone")).toBe(true);
  });

  it("GivenAParkedMilestone_WhenTheOwnerApprovesItOnTheEpicPanel_ThenTheStatusIsSavedAndLogged", async () => {
    const { harness, epic } = await seeded();
    await harness.router.navigate({ to: `/p/ai/t/${epic.key}` });
    const section = await screen.findByRole("region", { name: "Milestone" }, PAGE_LOAD);

    await pick(
      harness.user,
      await within(section).findByRole("combobox", { name: "Status of M6: Dev → prod releases" }),
      "Approved",
    );

    await waitFor(async () =>
      expect((await harness.milestones.get("ai", "m6"))?.status).toBe("approved"),
    );
    await waitFor(() =>
      expect(chip(section)?.textContent).toBe("M6: Dev → prod releases · Approved"),
    );
    const log = await harness.configChanges.listForProject("ai");
    expect(log.filter((c) => c.entity === "milestone")).toHaveLength(1);
  });
});

describe("milestone on the board's epic groups (AI-311)", () => {
  it("GivenAParkedMilestone_WhenTheBoardIsGrouped_ThenItsEpicsGroupsShowParked", async () => {
    const { harness, child } = await seeded();
    await harness.router.navigate({ to: "/p/ai" });
    await screen.findByText("AI-3", undefined, PAGE_LOAD);

    await harness.user.click(screen.getByRole("switch", { name: "Group by epic" }));

    // AI-3's group is its child epic's, which takes M6 from its top-level epic.
    const header = document.querySelector<HTMLElement>(`[data-epic="${child.key}"]`)!;
    await waitFor(() => expect(chip(header)?.textContent).toBe("M6: Dev → prod releases · Parked"));
    // The loose epic has no tickets, so no card and no header (AI-403); the roadmap lists it.
    const backlog = screen.getByRole("region", { name: "Backlog" });
    expect(backlog.querySelector('[data-ticket="AI-4"], [data-label="AI-4"]')).toBeNull();
  });
});

describe("milestone status on the roadmap (AI-311)", () => {
  it("GivenAnOpenRoadmapRow_WhenTheOwnerParksTheMilestone_ThenTheRowShowsParked", async () => {
    const { harness } = await seeded();
    await harness.router.navigate({ to: "/p/ai/roadmap" });

    // AI-378: the status pick sits in the row itself.
    const status = await screen.findByRole("group", { name: "Status of M4: Epics" }, PAGE_LOAD);
    await harness.user.click(within(status).getByRole("button", { name: "Parked" }));

    await waitFor(async () =>
      expect((await harness.milestones.get("ai", "m4"))?.status).toBe("parked"),
    );
    await waitFor(() =>
      expect(document.querySelector('li[data-milestone="m4"]')?.getAttribute("data-status")).toBe(
        "parked",
      ),
    );
  });
});

describe("held ticket's status line (AI-311)", () => {
  it("GivenAReadyTicketInAParkedMilestone_WhenItsPanelOpens_ThenTheStatusSaysTheMilestoneIsParked", async () => {
    const { harness, story } = await seeded();

    await harness.router.navigate({ to: `/p/ai/t/${story.key}` });

    const status = await screen.findByRole("status", { name: "Status" }, PAGE_LOAD);
    await within(status).findByText("Waiting: Milestone M6: Dev → prod releases is parked");
  });
});
