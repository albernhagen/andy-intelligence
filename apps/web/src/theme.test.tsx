import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { applyTheme, loadTheme } from "@/lib/theme";
import { renderApp } from "@/test/harness";

/** AI-367: the theme switch (system, light, dark; ADR-0151). The CSS rules: scripts/tokens.test.ts. */

const theme = () => document.documentElement.dataset.theme;

afterEach(() => {
  window.localStorage.clear();
  applyTheme("system");
});

async function openThemeMenu() {
  const harness = renderApp("/all/inbox");
  await harness.user.click(await screen.findByRole("button", { name: "Settings" }));
  const group = within(await screen.findByRole("menu")).getByRole("group", { name: "Theme" });
  return { harness, group };
}

describe("theme switch", () => {
  it("GivenNoChoice_WhenTheMenuOpens_ThenSystemIsPickedAndThePageFollowsTheOs", async () => {
    const { group } = await openThemeMenu();
    const picked = within(group).getByRole("menuitemradio", { name: "System" });
    expect(picked.getAttribute("aria-checked")).toBe("true");
    expect(theme()).toBeUndefined();
  });

  it.each(["Dark", "Light"] as const)(
    "GivenSystem_WhenAndyPicks%s_ThenItAppliesAtOnceAndIsRemembered",
    async (label) => {
      const { harness, group } = await openThemeMenu();
      await harness.user.click(within(group).getByRole("menuitemradio", { name: label }));
      const value = label.toLowerCase();
      expect(theme()).toBe(value);
      expect(window.localStorage.getItem("andy.theme")).toBe(value);
      expect(loadTheme()).toBe(value);
    },
  );

  it("GivenDark_WhenAndyPicksSystem_ThenTheChoiceIsForgottenAndTheOsDecides", async () => {
    window.localStorage.setItem("andy.theme", "dark");
    applyTheme(loadTheme());
    const { harness, group } = await openThemeMenu();
    expect(
      within(group).getByRole("menuitemradio", { name: "Dark" }).getAttribute("aria-checked"),
    ).toBe("true");
    await harness.user.click(within(group).getByRole("menuitemradio", { name: "System" }));
    await waitFor(() => expect(theme()).toBeUndefined());
    expect(window.localStorage.getItem("andy.theme")).toBeNull();
  });

  it("GivenDarkAppliedButStorageEmptied_WhenTheMenuOpens_ThenDarkIsPicked", async () => {
    applyTheme("dark");
    window.localStorage.clear();
    const { group } = await openThemeMenu();
    expect(
      within(group).getByRole("menuitemradio", { name: "Dark" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("GivenAStoredValueThatIsNotATheme_WhenLoaded_ThenSystem", () => {
    window.localStorage.setItem("andy.theme", "sepia");
    expect(loadTheme()).toBe("system");
  });
});
