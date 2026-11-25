import { expect, test } from "@playwright/test";

/**
 * AI-243: M9.8, rebuilt by AI-376: Models. The default routing (only the Claude subscription on)
 * from the seeded fake API, with a fallback route added to Fast on OpenRouter (off), so it says
 * "Skipped: provider off" and the save bar shows one unsaved change, as in the approved mockup.
 * The image holds the routing form only, not the shell.
 */
test("models: global routing with a skipped fallback and the save bar", async ({ page }) => {
  await page.goto("/settings/models");
  const form = page.getByRole("form", { name: "Global routing" });
  const fast = form.getByRole("region", { name: "Tier Fast" });
  await expect(fast.getByText("Runs now")).toBeVisible();
  await fast.getByRole("button", { name: "Add a fallback route" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: /OpenCode/ }).click();
  await sheet.getByRole("radio", { name: /OpenRouter/ }).click();
  await sheet.getByRole("textbox", { name: "Fast route 2 model" }).fill("gemini-flash");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
  await expect(fast.getByText("Skipped: provider off")).toBeVisible();
  await expect(form.getByText("1 unsaved change")).toBeVisible();
  await expect(form).toHaveScreenshot("models.png");
});
