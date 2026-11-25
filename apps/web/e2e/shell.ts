import { expect, type Page } from "@playwright/test";

/**
 * Waits until the shell has its Needs-you counts and quota, so a screenshot never catches them
 * loading. Phone: the header's "Needs you 5". Desktop: the sidebar (AI-370), whose Main nav is
 * `aria-busy` until the counts arrive.
 */
export async function expectShellLoaded(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 640) {
    await expect(page.getByRole("link", { name: "Needs you 5" })).toBeVisible();
    return;
  }
  await expect(page.locator('nav[aria-label="Main"][aria-busy="false"]')).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Claude quota" }).or(page.getByText("Quota unknown")),
  ).toBeVisible();
}
