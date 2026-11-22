import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { PAGE_LOAD, renderApp } from "@/test/harness";

/** Roadmap reorder (AI-324): the owner moves milestones; each move saves and is logged. */
async function seeded(
  orders: [number, number, number] = [0, 10, 20],
  beforeFetch?: (request: Request) => Promise<void>,
) {
  const harness = renderApp("/", { beforeFetch });
  await harness.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  for (const [id, order, name] of [
    ["m1", orders[0], "M1: First flow"],
    ["m2", orders[1], "M2: Self-hosting"],
    ["m3", orders[2], "M3: Mobile"],
  ] as const) {
    await harness.milestones.create({
      id,
      projectId: "ai",
      name,
      outcome: `${name} works`,
      order,
      status: "approved",
      createdAt: "2026-11-21T00:00:00.000Z",
      updatedAt: "2026-11-21T00:00:00.000Z",
    });
  }
  await harness.router.navigate({ href: "/p/ai/roadmap" });
  await screen.findByRole("button", { name: /^M3: Mobile/ }, PAGE_LOAD);
  return harness;
}

const rows = () =>
  [...document.querySelectorAll("li[data-milestone]")].map((el) =>
    el.getAttribute("data-milestone"),
  );

describe("roadmap reorder", () => {
  it("GivenThreeMilestones_WhenOneIsMovedUpByKeyboard_ThenTheNewOrderShowsSavesAndIsLogged", async () => {
    const harness = await seeded();

    screen.getByRole("button", { name: "Move M3: Mobile up" }).focus();
    await harness.user.keyboard("{Enter}");

    await waitFor(() => expect(rows()).toEqual(["m1", "m3", "m2"]));
    await waitFor(async () =>
      expect((await harness.milestones.list("ai")).map((m) => m.id)).toEqual(["m1", "m3", "m2"]),
    );
    const logged = await harness.configChanges.listForProject("ai");
    expect(logged[0]).toMatchObject({ entity: "milestone", reason: "Reordered on the roadmap" });
  });

  it("GivenTheFirstAndLastMilestones_WhenShown_ThenTheyCannotMovePastTheEnds", async () => {
    await seeded();

    expect(screen.getByRole("button", { name: "Move M1: First flow up" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Move M3: Mobile down" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Drag M2: Self-hosting to reorder" })).toBeTruthy();
  });

  it("GivenAMilestone_WhenMovedDownTwice_ThenItEndsLast", async () => {
    const harness = await seeded();

    await harness.user.click(screen.getByRole("button", { name: "Move M1: First flow down" }));
    await waitFor(() => expect(rows()).toEqual(["m2", "m1", "m3"]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Move M1: First flow down" })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    await harness.user.click(screen.getByRole("button", { name: "Move M1: First flow down" }));

    await waitFor(async () =>
      expect((await harness.milestones.list("ai")).map((m) => m.id)).toEqual(["m2", "m3", "m1"]),
    );
  });

  it("GivenTheSaveFails_WhenAMilestoneIsMoved_ThenTheRowsGoBackAndTheErrorShows", async () => {
    let refuse = false;
    const harness = await seeded([0, 10, 20], async (request) => {
      if (refuse && request.method === "PATCH") throw new Error("Only the owner writes milestones");
    });
    refuse = true;

    await harness.user.click(screen.getByRole("button", { name: "Move M3: Mobile up" }));

    expect(await screen.findByText(/Only the owner writes milestones/)).toBeTruthy();
    await waitFor(() => expect(rows()).toEqual(["m1", "m2", "m3"]));
    expect((await harness.milestones.list("ai")).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("GivenNoRoomBetweenOrders_WhenMoved_ThenTheMilestonesAreRenumberedAndShowInTheNewOrder", async () => {
    const harness = await seeded([0, 1, 1]);

    await harness.user.click(screen.getByRole("button", { name: "Move M3: Mobile up" }));

    await waitFor(async () =>
      expect((await harness.milestones.list("ai")).map((m) => [m.id, m.order])).toEqual([
        ["m1", 0],
        ["m3", 10],
        ["m2", 20],
      ]),
    );
    await waitFor(() => expect(rows()).toEqual(["m1", "m3", "m2"]));
  });
});
