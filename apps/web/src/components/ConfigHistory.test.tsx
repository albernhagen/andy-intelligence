import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** M4.12: the settings page's Changes list and Revert, against the in-process API. */

/** Automation and Changes are separate sections (AI-372): each helper opens its own first. */
async function settingsPage() {
  const h = renderApp("/p/ai/settings");
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await h.queryClient.invalidateQueries();
  await screen.findByRole("region", { name: "Settings" });
  const section = async (name: string) => {
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    await h.user.click(within(nav).getByRole("link", { name }));
  };
  const autoRefine = async () => {
    await section("Automation");
    return screen.findByRole("switch", { name: "Auto-refine" });
  };
  const changes = async () => {
    await section("Changes");
    return screen.findByRole("region", { name: "Changes" });
  };
  return { h, autoRefine, changes };
}

const isOn = (el: HTMLElement) => el.getAttribute("aria-checked") === "true";

afterEach(() => window.localStorage.clear());

describe("settings Changes list", () => {
  it("GivenNoChanges_WhenThePageOpens_ThenTheListSaysSo", async () => {
    const { changes } = await settingsPage();
    expect(await within(await changes()).findByText("No settings changes yet.")).toBeTruthy();
  });

  it("GivenAFlip_WhenAndyRevertsIt_ThenTheSettingIsBackAndTheRevertIsListedToo", async () => {
    const { h, autoRefine, changes } = await settingsPage();
    await h.user.click(await autoRefine());
    await waitFor(async () => expect((await h.tracker.getProject("ai"))?.autoRefine).toBe(false));
    const list = await changes();
    const row = await within(list).findByText("Auto-refine: on → off");
    expect(within(list).getByText(/^Andy · /)).toBeTruthy();

    await h.user.click(within(row.closest("li")!).getByRole("button", { name: "Revert" }));

    expect(await within(list).findByText("Auto-refine: off → on")).toBeTruthy();
    expect(within(list).getByText("Reverted")).toBeTruthy();
    expect(within(list).getByText(/· Revert of /)).toBeTruthy();
    await waitFor(async () => expect(isOn(await autoRefine())).toBe(true));
  });

  it("GivenTheSettingChangedAgain_WhenAndyRevertsTheOlderFlip_ThenItIsRefusedAndSaysWhy", async () => {
    const { h, autoRefine, changes } = await settingsPage();
    await h.user.click(await autoRefine());
    await waitFor(async () => expect((await h.tracker.getProject("ai"))?.autoRefine).toBe(false));
    await h.user.click(await autoRefine());
    await waitFor(async () => expect((await h.tracker.getProject("ai"))?.autoRefine).toBe(true));
    const list = await changes();
    await within(list).findByText("Auto-refine: off → on");
    const older = within(list).getByText("Auto-refine: on → off").closest("li")!;

    await h.user.click(within(older).getByRole("button", { name: "Revert" }));

    expect(await within(list).findByText(/changed since, by config change/)).toBeTruthy();
    expect(isOn(await autoRefine())).toBe(true);
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
    const row = (await within(await changes()).findByText("Routing: tiers changed")).closest("li")!;
    // AI-275: a routing change reverts from here too, through routing settings.
    expect(within(row).getByRole("button", { name: "Revert" })).toBeTruthy();
  });
});
