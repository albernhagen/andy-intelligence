import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { TierKey } from "@andy/contracts";
import { renderApp } from "@/test/harness";

/** AI-243: M9.8: Settings → Models against the in-process API and routing store. */

async function modelsPage() {
  const h = renderApp("/settings/models");
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await h.queryClient.invalidateQueries();
  const form = await screen.findByRole("form", { name: "Global routing" });
  return { h, form };
}

const routeModels = (tier: string) =>
  within(screen.getByRole("region", { name: `Tier ${tier}` }))
    .getAllByRole("textbox", { name: /model$/ })
    .map((i) => (i as HTMLInputElement).value);

describe("Models settings page", () => {
  it("GivenTheDefaults_WhenOpened_ThenEveryTierWithItsRoutesAndEveryProviderWithItsSwitch", async () => {
    const { form } = await modelsPage();
    for (const tier of TierKey.options) {
      expect(within(form).getByRole("region", { name: `Tier ${tier}` })).toBeTruthy();
    }
    expect(routeModels("frontier")).toEqual(["opus"]);
    expect(routeModels("fast")).toEqual(["sonnet"]);
    expect(
      (within(form).getByRole("checkbox", { name: "claude-sub on" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (within(form).getByRole("checkbox", { name: "google-sub on" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (within(form).getByRole("checkbox", { name: "openrouter on" }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("GivenAnIncompatibleRoute_WhenSaved_ThenTheApiReasonSitsByThatRouteAndTheDraftStays", async () => {
    const { h, form } = await modelsPage();
    const fast = within(form).getByRole("region", { name: "Tier fast" });
    await h.user.click(within(fast).getByRole("button", { name: "Add route" }));
    await h.user.selectOptions(
      within(fast).getByRole("combobox", { name: "fast route 2 harness" }),
      "jules",
    );
    const row = within(fast).getByRole("listitem", { name: "fast route 2" });
    // Shown before saving: why the resolver would skip it.
    expect(within(row).getByText(/harness jules doesn't run on provider claude-sub/)).toBeTruthy();

    await h.user.click(within(form).getByRole("button", { name: "Save routing" }));

    const refused = await within(row).findByRole("alert");
    expect(refused.textContent).toContain("Refused");
    expect(refused.textContent).toContain("harness jules doesn't run on provider claude-sub");
    expect(routeModels("fast")).toEqual(["sonnet", "sonnet"]);
    expect((await h.routing.getGlobal()).updatedAt).toBeNull();
  });

  it("GivenTwoRoutes_WhenReorderedAndSaved_ThenAReloadShowsTheNewOrder", async () => {
    const { h, form } = await modelsPage();
    const cheap = within(form).getByRole("region", { name: "Tier cheap" });
    await h.user.click(within(cheap).getByRole("button", { name: "Add route" }));
    await h.user.clear(within(cheap).getByRole("textbox", { name: "cheap route 2 model" }));
    await h.user.type(within(cheap).getByRole("textbox", { name: "cheap route 2 model" }), "haiku");
    await h.user.click(within(cheap).getByRole("button", { name: "Move cheap route 2 up" }));
    expect(routeModels("cheap")).toEqual(["haiku", "sonnet"]);

    await h.user.click(within(form).getByRole("button", { name: "Save routing" }));

    await waitFor(async () =>
      expect((await h.routing.getGlobal()).tiers.cheap.map((r) => r.model)).toEqual([
        "haiku",
        "sonnet",
      ]),
    );
    await h.queryClient.resetQueries();
    await screen.findByRole("form", { name: "Global routing" });
    await waitFor(() => expect(routeModels("cheap")).toEqual(["haiku", "sonnet"]));
  });

  it("GivenAProjectWithoutItsOwnRouting_WhenPicked_ThenItsNarrowedViewAndAProjectEditor", async () => {
    const { h } = await modelsPage();
    await h.user.selectOptions(screen.getByRole("combobox", { name: "Routing for" }), "ai");
    expect(await screen.findByText(/This project follows global/)).toBeTruthy();
    const narrowed = screen.getByRole("region", { name: "Narrowed view" });
    // frontier and strong both run on Opus by default.
    expect(within(narrowed).getAllByText(/claude-code\/claude-sub\/opus/)).toHaveLength(2);
    expect(screen.getByRole("form", { name: "Routing for ai" })).toBeTruthy();
  });
});
