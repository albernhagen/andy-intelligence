import { expect, test, type Page } from "@playwright/test";
import { expectPageFits } from "./phone";
import { expectShellLoaded } from "./shell";

/**
 * AI-385: the digest's handover on What's new: open PRs with why each waits (the seed's PR #74
 * waits on a kept path) and next up with why nothing starts, at 1280 and 390 px.
 */

const SEED_NOW = new Date("2026-11-04T15:00:00.000Z");

async function handover(page: Page) {
  await page.clock.setFixedTime(SEED_NOW);
  await page.goto("/p/ai/whats-new");
  await expectShellLoaded(page);
  await expect(page.getByRole("region", { name: "Open PRs" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Next up" })).toBeVisible();
  return page.locator("aside").filter({ has: page.getByRole("region", { name: "Next up" }) });
}

test("handover: open PRs and next up on What's new", async ({ page }) => {
  const aside = await handover(page);
  await expect(aside).toHaveScreenshot("handover.png");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("handover: open PRs and next up fit a phone", async ({ page }) => {
    const aside = await handover(page);
    await expectPageFits(page);
    // The fixed bottom bar would sit over the element's image; the full-screen images show it.
    await page
      .getByRole("navigation", { name: "Main" })
      .last()
      .evaluate((el) => {
        (el as HTMLElement).style.display = "none";
      });
    await expect(aside).toHaveScreenshot("phone-handover.png");
  });
});
