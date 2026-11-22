import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** M4.12: the settings page's Changes list and Revert, against the in-process API. */

async function settingsPage() {
  const h = renderApp("/p/ai/settings");
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await h.queryClient.invalidateQueries();
  const list = await screen.findByRole("region", { name: "Settings" });
  const autoRefine = () => within(list).getByRole("checkbox", { name: "Auto-refine" });
  return { h, autoRefine, changes: () => screen.getByRole("region", { name: "Changes" }) };
}

afterEach(() => window.localStorage.clear());

describe("settings Changes list", () => {
  it("GivenNoChanges_WhenThePageOpens_ThenTheListSaysSo", async () => {
    await settingsPage();
    expect(await screen.findByText("No settings changes yet.")).toBeTruthy();
  });

  it("GivenAFlip_WhenAndyRevertsIt_ThenTheSettingIsBackAndTheRevertIsListedToo", async () => {
    const { h, autoRefine, changes } = await settingsPage();
    await h.user.click(autoRefine());
    const row = await within(changes()).findByText("autoRefine: true → false");
    expect(within(changes()).getByText(/^Andy · /)).toBeTruthy();

    await h.user.click(within(row.closest("li")!).getByRole("button", { name: "Revert" }));

    await waitFor(() => expect((autoRefine() as HTMLInputElement).checked).toBe(true));
    expect(await within(changes()).findByText("autoRefine: false → true")).toBeTruthy();
    expect(within(changes()).getByText("Reverted")).toBeTruthy();
    expect(within(changes()).getByText(/· Revert of /)).toBeTruthy();
  });

  it("GivenTheSettingChangedAgain_WhenAndyRevertsTheOlderFlip_ThenItIsRefusedAndSaysWhy", async () => {
    const { h, autoRefine, changes } = await settingsPage();
    await h.user.click(autoRefine());
    await within(changes()).findByText("autoRefine: true → false");
    await h.user.click(autoRefine());
    const older = (await within(changes()).findByText("autoRefine: true → false")).closest("li")!;
    await within(changes()).findByText("autoRefine: false → true");

    await h.user.click(within(older).getByRole("button", { name: "Revert" }));

    expect(await within(changes()).findByText(/changed since, by config change/)).toBeTruthy();
    expect((autoRefine() as HTMLInputElement).checked).toBe(true);
  });

  it("GivenARoutingChange_WhenListed_ThenSummarisedWithRevert", async () => {
    const { h, changes } = await settingsPage();
    const at = new Date().toISOString();
    await h.configChanges.append({
      id: "routing-1",
      entity: "routing",
      entityId: "ai",
      projectId: "ai",
      diff: { tiers: { from: null, to: { fast: [] } } },
      actor: "andy",
      reason: "",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      dedupeKey: null,
      decidedBy: null,
      decidedAt: null,
    });
    await h.queryClient.invalidateQueries();
    const row = (await within(changes()).findByText("Routing: tiers changed")).closest("li")!;
    // AI-275: a routing change reverts from here too, through routing settings.
    expect(within(row).getByRole("button", { name: "Revert" })).toBeTruthy();
  });
});
