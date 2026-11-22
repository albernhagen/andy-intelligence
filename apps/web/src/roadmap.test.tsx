import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { InMemoryWorkTracker } from "@andy/contracts";
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

async function seeded(path: string) {
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
  const epic = (title: string) => tracker.createTicket("ai", { title, type: "epic" }, "andy");
  const done = await epic("First flow");
  const hosting = await epic("Builds itself");
  const mobile = await epic("Phone app");
  const loose = await epic("Parallel work");
  await tracker.updateTicket(
    "ai",
    done.id,
    { stage: { to: "done", forced: true, reason: null } },
    "andy",
  );
  const child = await tracker.createTicket(
    "ai",
    { title: "Runs a PR", parentId: hosting.id },
    "andy",
  );
  await tracker.updateTicket(
    "ai",
    child.id,
    { stage: { to: "ready_for_review", forced: true, reason: null } },
    "andy",
  );
  await tracker.createTicket("ai", { title: "Merges a PR", parentId: hosting.id }, "andy");
  milestoneOfKey.set(done.key, "m1");
  milestoneOfKey.set(hosting.key, "m2");
  milestoneOfKey.set(mobile.key, "m3");
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
    expect(within(hosting).getByText("Not reviewed")).toBeTruthy();
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
    expect(within(ops).getByText("No milestones or epics yet.")).toBeTruthy();
  });

  it("GivenTheShell_WhenAProjectIsOpen_ThenRoadmapIsLinked", async () => {
    await seeded("/p/ai/roadmap");

    const link = screen.getAllByRole("link", { name: "Roadmap" })[0]!;
    expect(link.getAttribute("href")).toBe("/p/ai/roadmap");
  });
});
