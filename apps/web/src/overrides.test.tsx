import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** The rail's Overrides section (AI-116: M4.5: Epic overrides cascade and overrides editor). */
describe("overrides editor", () => {
  async function withEpicTier() {
    const harness = renderApp();
    const { tracker } = harness;
    await tracker.createProject({ name: "AI", key: "AI" });
    const epic = await tracker.createTicket(
      "ai",
      { title: "Epics", type: "epic", overrides: { tier: "frontier", assignee: "me" } },
      "andy",
    );
    const child = await tracker.createTicket(
      "ai",
      { title: "Child", type: "feature", size: "S", parentId: epic.id },
      "andy",
    );
    return { harness, epic, child };
  }

  it("GivenAnInheritedTier_WhenTheChildOpens_ThenTheRailShowsTheValueAndTheEpic", async () => {
    const { harness, epic, child } = await withEpicTier();
    await harness.router.navigate({ to: `/p/ai/t/${child.key}` });

    const overrides = await screen.findByRole("region", { name: "Overrides" });
    await within(overrides).findByText(`From epic ${epic.key}`);
    const tier = within(overrides).getByLabelText("Tier") as HTMLSelectElement;
    expect(tier.selectedOptions[0]!.textContent).toBe(`frontier (from epic ${epic.key})`);
    expect(within(overrides).getAllByText(`From epic ${epic.key}`)).toHaveLength(1);
    expect(within(overrides).getByText(`Worker: Andy (from epic ${epic.key})`)).toBeTruthy();
  });

  it("GivenAnInheritedTier_WhenAndyPicksOne_ThenItIsTheTicketsOwn", async () => {
    const { harness, epic, child } = await withEpicTier();
    await harness.router.navigate({ to: `/p/ai/t/${child.key}` });
    const overrides = await screen.findByRole("region", { name: "Overrides" });
    await within(overrides).findByText(`From epic ${epic.key}`);

    await harness.user.selectOptions(within(overrides).getByLabelText("Tier"), "cheap");

    await waitFor(async () => {
      expect((await harness.tracker.getTicket("ai", child.id))!.overrides.tier).toBe("cheap");
    });
    expect((await harness.tracker.getTicket("ai", epic.id))!.overrides.tier).toBe("frontier");
    await waitFor(() => expect(within(overrides).queryByText(`From epic ${epic.key}`)).toBeNull());
  });

  it("GivenAnEpic_WhenItsPanelOpens_ThenItsOwnOverridesEditInPlace", async () => {
    const { harness, epic } = await withEpicTier();
    await harness.router.navigate({ to: `/p/ai/t/${epic.key}` });
    const overrides = await screen.findByRole("region", { name: "Overrides" });

    await harness.user.selectOptions(within(overrides).getByLabelText("Autonomy"), "gated");

    await waitFor(async () => {
      expect((await harness.tracker.getTicket("ai", epic.id))!.overrides).toEqual({
        tier: "frontier",
        assignee: "me",
        autonomy: "gated",
      });
    });
  });
});
