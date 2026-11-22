import { expect, test } from "@playwright/test";
import { expectPageFits } from "./phone";

/**
 * AI-173: M7.3: Phone shell — the shell at iPhone width (390×844): picker and "Needs you" in the
 * header, navigation in a bottom bar. Phone specs set their viewport here, not in the config.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("phone shell: inbox", async ({ page }) => {
  await page.goto("/p/ai/inbox");
  await expect(page.getByText("Should Esc close the panel?").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Needs you 6" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  const width = await page.evaluate(() => document.querySelector("header")!.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await expectPageFits(page);
  await expect(page).toHaveScreenshot("phone-shell-inbox.png");
});

test("phone shell: More menu open on the board", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T15:00:00.000Z"));
  await page.goto("/p/ai");
  await expect(page.getByText("Building · 12 min").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Needs you 6" })).toBeVisible();
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Project settings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await expectPageFits(page);
  await expect(page).toHaveScreenshot("phone-shell-board-more.png");
});
