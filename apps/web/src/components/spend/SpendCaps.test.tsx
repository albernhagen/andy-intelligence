import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { PAGE_LOAD, renderApp } from "@/test/harness";
import { parseUsd, usd } from "./SpendCaps";

/** AI-249: M10.8: the settings page's Spend caps panel, against the in-process API. */

describe("parseUsd", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["5", 5_000_000],
    ["$1.5", 1_500_000],
    ["0.05", 50_000],
    ["12.34", 12_340_000],
    ["1.234", undefined],
    ["-1", undefined],
    ["1e3", undefined],
    ["abc", undefined],
  ])("GivenText%s_WhenParsed_Then%s", (text, micro) => {
    expect(parseUsd(text)).toBe(micro);
  });

  it("GivenMicroDollars_WhenShown_ThenWholeCents", () => {
    expect(usd(1_239_999)).toBe("$1.23");
  });
});

async function settingsPage() {
  const h = renderApp("/p/ai/settings");
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await h.queryClient.invalidateQueries();
  const panel = await screen.findByRole("region", { name: "Spend caps" }, PAGE_LOAD);
  const field = (label: string) =>
    within(panel).getByRole("textbox", { name: `${label} cap for this project, in dollars` });
  return { h, panel, field };
}

afterEach(() => window.localStorage.clear());

describe("Spend caps panel", () => {
  it("GivenANewProject_WhenSettingsOpen_ThenGlobalDefaultsShowAndSpendIsUnknown", async () => {
    const { panel, field } = await settingsPage();
    const daily = within(panel).getByRole("row", { name: /^Daily/ });
    expect(within(daily).getAllByText("$5.00")).toHaveLength(2);
    expect((field("Daily") as HTMLInputElement).value).toBe("");
    expect(within(panel).getByLabelText("Spent").textContent).toContain("unknown");
  });

  it("GivenALowerCap_WhenAndySavesIt_ThenItIsInForceAndListedInChanges", async () => {
    const { h, panel, field } = await settingsPage();
    await h.user.type(field("Daily"), "1.50");
    await h.user.type(
      within(panel).getByRole("textbox", { name: "Reason for the change" }),
      "trial",
    );
    await h.user.click(within(panel).getByRole("button", { name: "Save caps" }));

    await waitFor(async () =>
      expect((await h.tracker.getProject("ai"))?.spendCaps).toMatchObject({
        dailyMicroUsd: 1_500_000,
      }),
    );
    const daily = within(panel).getByRole("row", { name: /^Daily/ });
    expect(await within(daily).findByText("$1.50")).toBeTruthy();
    const changes = screen.getByRole("region", { name: "Changes" });
    expect(await within(changes).findByText(/^spendCaps: /)).toBeTruthy();
  });

  it("GivenACapAboveGlobal_WhenAndySavesIt_ThenTheRefusalSaysWhyAndNothingIsStored", async () => {
    const { h, panel, field } = await settingsPage();
    await h.user.type(field("Per task"), "3");
    await h.user.click(within(panel).getByRole("button", { name: "Save caps" }));

    expect(await within(panel).findByText(/above the global per-task cap \$2\.00/)).toBeTruthy();
    expect((await h.tracker.getProject("ai"))?.spendCaps).toEqual({});
  });

  it("GivenTextThatIsntDollars_WhenTyped_ThenSaveIsDisabledAndTheFieldIsNamed", async () => {
    const { h, panel, field } = await settingsPage();
    await h.user.type(field("Monthly"), "1.234");
    expect(within(panel).getByText(/^Monthly: dollars with at most two decimals/)).toBeTruthy();
    expect(
      (within(panel).getByRole("button", { name: "Save caps" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
