import type { Locator, Page } from "@playwright/test";

/**
 * Presses the mouse on `from`'s centre and moves it by (dx, dy) in small steps, leaving the drag
 * held so a screenshot shows it mid-drag (AI-396). End it with `cancelDrag`.
 */
export async function holdMidDrag(page: Page, from: Locator, dx: number, dy: number) {
  const box = (await from.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y + (dy * i) / 10);
}

/** Cancels the held drag (Escape), so nothing moves on the fake API the other checks share. */
export async function cancelDrag(page: Page) {
  await page.keyboard.press("Escape");
  await page.mouse.up();
}
