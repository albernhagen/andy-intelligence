import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { PAGE_LOAD, renderApp } from "@/test/harness";

/** AI-276: the global spend caps on Settings → Models, against the in-process API and store. */

async function modelsPage() {
  const h = renderApp("/settings/models");
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await h.queryClient.invalidateQueries();
  const panel = await screen.findByRole("region", { name: "Global spend caps" }, PAGE_LOAD);
  const field = (label: string) =>
    within(panel).getByRole("textbox", { name: `Global ${label} cap, in dollars` });
  return { h, panel, field };
}

afterEach(() => window.localStorage.clear());

describe("Global spend caps panel", () => {
  it("GivenNothingSaved_WhenModelsOpens_ThenTheDefaultsShowAndSaySo", async () => {
    const { panel, field } = await modelsPage();
    expect((field("daily") as HTMLInputElement).value).toBe("5.00");
    expect((field("per task") as HTMLInputElement).value).toBe("2.00");
    expect(within(panel).getByText(/code defaults; nothing is saved yet/)).toBeTruthy();
    expect(await within(panel).findByText("No global spend caps changes yet.")).toBeTruthy();
  });

  it("GivenALowerDailyCap_WhenAndySavesIt_ThenItIsLoggedAndRevertBringsTheDefaultBack", async () => {
    const { h, panel, field } = await modelsPage();
    await h.user.clear(field("daily"));
    await h.user.type(field("daily"), "3");
    await h.user.type(
      within(panel).getByRole("textbox", { name: "Reason for the global change" }),
      "tighter",
    );
    await h.user.click(within(panel).getByRole("button", { name: "Save global caps" }));

    const changes = within(panel).getByRole("region", { name: "Spend caps changes" });
    const row = await within(changes).findByText("daily $5.00 → $3.00");
    expect(within(changes).getByText(/· tighter$/)).toBeTruthy();

    await h.user.click(within(row.closest("li")!).getByRole("button", { name: "Revert" }));
    expect(await within(changes).findByText("daily $3.00 → $5.00")).toBeTruthy();
    await waitFor(() => expect((field("daily") as HTMLInputElement).value).toBe("5.00"));
  });

  // Review on PR #294: the panel shows whole cents; a cap Andy didn't edit keeps its exact value.
  it("GivenASubCentCap_WhenOnlyDailyIsEditedAndSaved_ThenTheOtherCapsKeepTheirExactValues", async () => {
    const { h, panel, field } = await modelsPage();
    await h.spendCapsStore.putGlobal(
      { dailyMicroUsd: 5_000_000, monthlyMicroUsd: 50_005_000, perTaskMicroUsd: 1_234_567 },
      null,
    );
    await h.queryClient.invalidateQueries();
    await waitFor(() => expect((field("per task") as HTMLInputElement).value).toBe("1.23"));

    await h.user.clear(field("daily"));
    await h.user.type(field("daily"), "3");
    await h.user.click(within(panel).getByRole("button", { name: "Save global caps" }));

    await waitFor(async () =>
      expect(await h.spendCapsStore.getGlobal()).toMatchObject({
        dailyMicroUsd: 3_000_000,
        monthlyMicroUsd: 50_005_000,
        perTaskMicroUsd: 1_234_567,
      }),
    );
  });

  it("GivenAnEmptyCap_WhenTyped_ThenSaveIsDisabled", async () => {
    const { h, panel, field } = await modelsPage();
    await h.user.clear(field("monthly"));
    expect(within(panel).getByText(/^Monthly: dollars with at most two decimals/)).toBeTruthy();
    expect(
      (within(panel).getByRole("button", { name: "Save global caps" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("project Spend caps panel after a global save", () => {
  it("GivenALoweredGlobal_WhenTheProjectSettingsOpen_ThenGlobalShowsItAndItIsInForce", async () => {
    const { h, panel, field } = await modelsPage();
    await h.user.clear(field("daily"));
    await h.user.type(field("daily"), "3");
    await h.user.click(within(panel).getByRole("button", { name: "Save global caps" }));
    await within(panel).findByText("daily $5.00 → $3.00");

    await h.router.navigate({ to: "/p/ai/settings" });
    const project = await screen.findByRole("region", { name: "Spend caps" }, PAGE_LOAD);
    const daily = within(project).getByRole("row", { name: /^Daily/ });
    expect(await within(daily).findAllByText("$3.00")).toHaveLength(2);
    expect(within(project).getByRole("columnheader", { name: "Global" })).toBeTruthy();
  });
});
