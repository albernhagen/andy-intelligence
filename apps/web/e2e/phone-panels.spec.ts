import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * AI-379: on a phone, panels and dialogs take the whole screen and close with one tap. The ticket
 * panel (AI-375) and the Models route sheet (AI-376) are the two that open on a phone today.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const SEED_NOW = new Date("2026-11-04T15:00:00.000Z");

async function expectFullScreen(page: Page, el: Locator) {
  const { width, height } = page.viewportSize()!;
  // Polled: the enter animation moves it a few pixels for its first 180 ms.
  await expect
    .poll(() => el.boundingBox(), { message: "covers the screen" })
    .toEqual({
      x: 0,
      y: 0,
      width,
      height,
    });
}

test("phone: the ticket panel is full-screen and one tap closes it", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await page.goto("/p/ai/t/AI-1");
  const panel = page.getByRole("dialog", { name: /^AI-1: / });
  await expect(panel).toBeVisible();
  await expectFullScreen(page, panel);
  await panel.getByRole("button", { name: "Close" }).tap();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/p\/ai$/);
});

test("phone: a Models route sheet is full-screen and one tap closes it", async ({ page }) => {
  await page.goto("/settings/models");
  await page
    .getByRole("button", { name: /^Edit / })
    .first()
    .tap();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expectFullScreen(page, sheet);
  await sheet.getByRole("button", { name: "Close" }).tap();
  await expect(sheet).toBeHidden();
});
