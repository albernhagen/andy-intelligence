import { expect, test } from "@playwright/test";

/**
 * AI-243: M9.8: Models settings page. The default routing (only claude-sub on) from the seeded
 * fake API, with one incompatible route added so a skip reason shows. The image holds the
 * routing form only, not the shell, and is taken once the form has loaded (no animation).
 */
test("models: global routing with a skipped route", async ({ page }) => {
  await page.goto("/settings/models");
  const form = page.getByRole("form", { name: "Global routing" });
  await expect(form.getByRole("region", { name: "Tier cheap" })).toBeVisible();
  const cheap = form.getByRole("region", { name: "Tier cheap" });
  await cheap.getByRole("button", { name: "Add route" }).click();
  await cheap.getByRole("combobox", { name: "cheap route 2 harness" }).selectOption("jules");
  await cheap.getByRole("textbox", { name: "cheap route 2 model" }).fill("jules");
  await expect(cheap.getByText(/doesn't run on provider claude-sub/)).toBeVisible();
  await expect(form).toHaveScreenshot("models.png");
});
