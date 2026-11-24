import { expect, test, type Page } from "@playwright/test";
import { mockDashboards, waitForStableCharts } from "./dashboard-fixtures";
import { SCREENS, type Screen } from "./screens";

/**
 * AI-366: every screen in src/router.tsx (e2e/screens.ts) at 1280×800 and 390×844, and the shell,
 * inbox, board and project settings also dark. Viewport-sized images, so each is the first screen
 * Andy sees; the other specs keep the full-page and state-specific images.
 */

/** The seed's clock (e2e/fake-api.ts), so relative times never change. */
const SEED_NOW = new Date("2026-11-04T15:00:00.000Z");
const PHONE = { width: 390, height: 844 };

/** Screens that need more than a URL to open. */
const OPEN: Record<string, (page: Page) => Promise<void>> = {
  // The dashboard reads use the server's real clock; serve the fixed ones.
  "all-dashboards": mockDashboards,
  dashboards: mockDashboards,
};

async function open(page: Page, screen: Screen) {
  await page.clock.setFixedTime(SEED_NOW);
  await OPEN[screen.name]?.(page);
  await page.goto(screen.url);
  if (screen.name === "agent-task") {
    // The run's id is random, so open it from its ticket's panel.
    await page.getByRole("link", { name: "Agent task · refine" }).click();
    await expect(page.getByRole("heading", { name: "Agent task · refine" })).toBeVisible();
  }
  await expect(page.getByText(screen.ready).first()).toBeVisible();
  // The header count is loaded once every screen has it.
  await expect(page.getByRole("link", { name: "Needs you 5" })).toBeVisible();
  if (screen.name.endsWith("dashboards")) await waitForStableCharts(page);
}

for (const screen of SCREENS) {
  test(`screen ${screen.route} at desktop`, async ({ page }) => {
    await open(page, screen);
    await expect(page).toHaveScreenshot(`screen-${screen.name}.png`);
  });

  test(`screen ${screen.route} on a phone`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, screen);
    await expect(page).toHaveScreenshot(`phone-screen-${screen.name}.png`);
  });

  if (screen.dark) {
    test(`screen ${screen.route} dark`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await open(page, screen);
      await expect(page).toHaveScreenshot(`screen-${screen.name}-dark.png`);
    });
  }
}

test("shell: project picker open, dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(
    page,
    SCREENS.find((s) => s.name === "inbox")!,
  );
  await page.getByRole("button", { name: /^OPS Ops/ }).click();
  await expect(page.getByRole("menuitem", { name: /Add project/ })).toBeVisible();
  await expect(page).toHaveScreenshot("screen-shell-dark.png");
});
