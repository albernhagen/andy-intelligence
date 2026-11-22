import { expect, test } from "@playwright/test";
import { expectPageFits } from "./phone";

/**
 * AI-325: Phone: no screen scrolls sideways. Each screen at 390 px is no wider than the viewport.
 * Screens with their own phone spec (the ticket panel, the inbox) check it there.
 */

const SEED_NOW = new Date("2026-11-04T15:00:00.000Z");

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const screens: { name: string; path: string; ready: string }[] = [
  { name: "board", path: "/p/ai", ready: "Building · 12 min" },
  { name: "busy board", path: "/p/ops", ready: "Monthly restore drill" },
  { name: "epic panel", path: "/p/ops/t/OPS-5", ready: "1 of 3 done" },
  { name: "dashboards", path: "/p/ai/dashboards", ready: "Dashboards" },
  { name: "dashboards, all projects", path: "/all/dashboards", ready: "Dashboards" },
];

for (const s of screens) {
  test(`phone width: ${s.name} fits 390 px`, async ({ page }) => {
    await page.clock.setFixedTime(SEED_NOW);
    await page.goto(s.path);
    await expect(page.getByText(s.ready).first()).toBeVisible();
    await expectPageFits(page);
  });
}
