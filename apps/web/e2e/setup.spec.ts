import { expect, test, type Page } from "@playwright/test";
import { expectShellLoaded } from "./shell";
import { expectPageFits, expectTouchTargets } from "./phone";
import { mockApproveStep, mockBriefStep } from "./setup-fixtures";

/**
 * AI-373: the setup path's approve step at 1280 px (light and dark) and 390 px, matching the
 * approved mockup (`docs/build-log/assets/2026-11-23-design-review/screen-onboard-approve.png`).
 * The brief step's images come from coverage.spec.ts (`screen-setup*.png`).
 */

const SEED_NOW = new Date("2026-11-04T15:00:00.000Z");

async function openApprove(page: Page) {
  await page.clock.setFixedTime(SEED_NOW);
  await mockApproveStep(page);
  await page.goto("/p/ai/setup");
  await expect(page.getByRole("heading", { name: "Approve the plan" })).toBeVisible();
  await expectShellLoaded(page);
}

test("setup: approve step at desktop", async ({ page }) => {
  await openApprove(page);
  await page
    .getByRole("group", { name: "M3: Share with friends" })
    .getByRole("button", { name: "Park" })
    .click();
  await expect(page.getByRole("button", { name: /Approve 2, park 1/ })).toBeVisible();
  await expect(page).toHaveScreenshot("setup-approve.png");
});

test("setup: approve step dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openApprove(page);
  await expect(page).toHaveScreenshot("setup-approve-dark.png");
});

test("setup: approve step on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApprove(page);
  await expectPageFits(page);
  await expectTouchTargets(page.locator('section[aria-labelledby^="step-"]'));
  await expect(page).toHaveScreenshot("phone-setup-approve.png", { fullPage: true });
});

test("setup: brief step on a phone fits", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(SEED_NOW);
  await mockBriefStep(page);
  await page.goto("/p/ai/setup");
  await expect(page.getByText("What are you building, and for whom?")).toBeVisible();
  await expectPageFits(page);
  await expectTouchTargets(page.locator('section[aria-labelledby^="step-"]'));
});
