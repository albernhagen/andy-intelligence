import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";
import { LAYER_ORDER_LINE } from "@/lib/route-layers";

/** AI-282: M9: the layer that set a ticket's worker, tier and route, and the settings line. */
describe("routing layers", () => {
  async function ticketUnderEpic() {
    const harness = renderApp();
    const { tracker } = harness;
    await tracker.createProject({ name: "AI", key: "AI" });
    const epic = await tracker.createTicket(
      "ai",
      { title: "M9: Routing", type: "epic", overrides: { tier: "strong", assignee: "me" } },
      "andy",
    );
    const child = await tracker.createTicket(
      "ai",
      { title: "Layers", type: "feature", size: "S", parentId: epic.id },
      "andy",
    );
    return { harness, epic, child };
  }

  it("GivenAnEpicTierAndWorker_WhenTheTicketOpens_ThenTheRailNamesEachLayer", async () => {
    const { harness, epic, child } = await ticketUnderEpic();
    await harness.router.navigate({ to: `/p/ai/t/${child.key}` });

    const routing = await screen.findByRole("region", { name: "Routing" });
    expect(within(routing).getByText("Routing (build step)")).toBeTruthy();
    const worker = within(routing).getByText("Worker").closest("li")!;
    expect(worker.textContent).toBe(`Worker me · epic override ${epic.key}`);
    const tier = within(routing).getByText("Tier").closest("li")!;
    expect(tier.textContent).toBe(`Tier strong · epic override ${epic.key}`);
    const route = within(routing).getByText("Route").closest("li")!;
    expect(route.textContent).toContain("opus (claude-code, claude-sub) · global");
    expect(within(routing).queryByRole("list", { name: "Skipped routes" })).toBeNull();
  });

  it("GivenATicketWithoutOverrides_WhenItOpens_ThenTheWorkerIsTheProjectDefault", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    const child = await harness.tracker.createTicket(
      "ai",
      { title: "Plain", type: "feature", size: "M" },
      "andy",
    );
    await harness.router.navigate({ to: `/p/ai/t/${child.key}` });

    const routing = await screen.findByRole("region", { name: "Routing" });
    const worker = (await within(routing).findByText("Worker")).closest("li")!;
    expect(worker.textContent).toBe("Worker agent · project default");
    const tier = within(routing).getByText("Tier").closest("li")!;
    expect(tier.textContent).toBe("Tier strong · global (size M → strong)");
  });

  it("GivenTheSettingsPages_WhenOpened_ThenBothNameTheFourLayersInOrder", async () => {
    const harness = renderApp();
    await harness.tracker.createProject({ name: "AI", key: "AI" });
    expect(LAYER_ORDER_LINE).toContain(
      "ticket override, then epic override, then project default, then global",
    );

    await harness.router.navigate({ to: "/settings/models" });
    expect(await screen.findByText(LAYER_ORDER_LINE)).toBeTruthy();

    await harness.router.navigate({ to: "/p/ai/settings", hash: "defaults" });
    expect(await screen.findByText(LAYER_ORDER_LINE)).toBeTruthy();
  });
});
