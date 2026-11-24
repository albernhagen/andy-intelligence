import { expect, test } from "@playwright/test";
import { expectPageFits, expectTouchTargets } from "./phone";

/**
 * AI-334: Phone: 44 px targets on settings and the board's title row. At 390 px every settings
 * control is a 44 px target, and the board's title stays on its own line above its checkboxes
 * (under Options since AI-337).
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("phone targets: project settings", async ({ page }) => {
  await page.goto("/p/ai/settings");
  await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Changes" }).getByRole("button").first(),
  ).toBeVisible();
  await expectTouchTargets(page.locator("main"));
  await expectPageFits(page);
});

test("phone targets: Models", async ({ page }) => {
  await page.goto("/settings/models");
  await expect(page.getByRole("region", { name: "Providers" })).toBeVisible();
  await expectTouchTargets(page.locator("main"));
  await expectPageFits(page);
});

test("phone targets: the board's title row", async ({ page }) => {
  await page.goto("/p/ops");
  const title = page.getByRole("heading", { name: /^Board/ });
  await page.getByRole("button", { name: "Options" }).click();
  await expect(page.getByRole("switch", { name: "Group by epic" })).toBeVisible();
  const row = page.locator("main section > div").first();
  await expectTouchTargets(row);
  // The title is one line, and the controls under Options sit below it; the View menu sits
  // beside it (AI-337).
  const t = (await title.boundingBox())!;
  expect(t.height).toBeLessThan(40);
  for (const label of await row.locator("label").filter({ hasNotText: /^View/ }).all()) {
    const b = (await label.boundingBox())!;
    expect(b.y, `${await label.textContent()} sits below the title`).toBeGreaterThanOrEqual(
      t.y + t.height,
    );
  }
});
