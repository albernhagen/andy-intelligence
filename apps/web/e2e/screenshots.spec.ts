import { expect, test, type Page } from "@playwright/test";

/**
 * AI-26: screenshot checks for the shell, board and ticket page. A diff fails CI; a deliberate
 * change updates the stored images in the same PR (README: "Screenshot checks").
 */

async function open(page: Page, path: string, ready: string) {
  await page.goto(path);
  await expect(page.getByText(ready).first()).toBeVisible();
  // The header count is loaded once every screen has it.
  await expect(page.getByRole("link", { name: "Needs you 2" })).toBeVisible();
}

test("shell: inbox under All projects", async ({ page }) => {
  await open(page, "/all/inbox", "Keep backups for 7 or 30 days?");
  await expect(page).toHaveScreenshot("shell-all-projects-inbox.png");
});

test("shell: project picker open", async ({ page }) => {
  await open(page, "/p/ai/inbox", "Should Esc close the panel?");
  await page.getByRole("button", { name: /Andy Intelligence/ }).click();
  await expect(page.getByRole("menuitem", { name: /Add project/ })).toBeVisible();
  await expect(page).toHaveScreenshot("shell-picker-open.png");
});

test("board", async ({ page }) => {
  await open(page, "/p/ai", "Dropping a card opens the ticket");
  await expect(page).toHaveScreenshot("board.png", { fullPage: true });
});

test("board under All projects asks for a project", async ({ page }) => {
  await open(page, "/all/board", "A board shows one project");
  await expect(page).toHaveScreenshot("board-pick-project.png");
});

test("ticket page", async ({ page }) => {
  await open(page, "/p/ai/t/AI-1", "Picking a project should feel like picking a tenant.");
  await expect(page).toHaveScreenshot("ticket.png", { fullPage: true });
});
