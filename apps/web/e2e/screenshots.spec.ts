import { expect, test, type Page } from "@playwright/test";

/**
 * AI-26: screenshot checks for the shell, board, story panel (AI-29), inbox (AI-30) and agent task page (AI-101). A diff fails CI; a deliberate
 * change updates the stored images in the same PR (README: "Screenshot checks").
 */

async function open(page: Page, path: string, ready: string) {
  await page.goto(path);
  await expect(page.getByText(ready).first()).toBeVisible();
  // The header count is loaded once every screen has it.
  await expect(page.getByRole("link", { name: "Needs you 6" })).toBeVisible();
}

test("shell: inbox under All projects", async ({ page }) => {
  await open(page, "/all/inbox", "Keep backups for 7 or 30 days?");
  await expect(page).toHaveScreenshot("shell-all-projects-inbox.png");
});

test("inbox: busy project with a stale ticket", async ({ page }) => {
  await open(page, "/p/ops/inbox", "Delete the old bucket too?");
  await expect(page).toHaveScreenshot("inbox-busy.png", { fullPage: true });
});

test("shell: project picker open", async ({ page }) => {
  await open(page, "/p/ai/inbox", "Should Esc close the panel?");
  await page.getByRole("button", { name: /Andy Intelligence/ }).click();
  await expect(page.getByRole("menuitem", { name: /Add project/ })).toBeVisible();
  await expect(page).toHaveScreenshot("shell-picker-open.png");
});

/** The seed's clock (e2e/fake-api.ts), so "Building · 12 min" on a card or the panel never changes. */
const SEED_NOW = new Date("2026-11-04T15:00:00.000Z");

test("board: every card marker, Done as a strip", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ai", "Building · 12 min");
  await expect(page).toHaveScreenshot("board.png", { fullPage: true });
});

test("board: Done expanded", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ai", "Building · 12 min");
  await page.getByRole("button", { name: /^Show Done/ }).click();
  await expect(page.getByText("Ticket core")).toBeVisible();
  await expect(page).toHaveScreenshot("board-expanded.png", { fullPage: true });
});

test("board under All projects asks for a project", async ({ page }) => {
  await open(page, "/all/board", "A board shows one project");
  await expect(page).toHaveScreenshot("board-pick-project.png");
});

test("story panel over the board", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ai/t/AI-1", "Picking a project should feel like picking a tenant.");
  await expect(page.getByText("Ship it")).toBeVisible();
  await expect(page).toHaveScreenshot("story-panel.png");
});

test("story panel editing the description", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ai/t/AI-1", "Picking a project should feel like picking a tenant.");
  await page.getByRole("button", { name: "Edit description" }).click();
  await expect(page.getByLabel("Description")).toBeVisible();
  await expect(page).toHaveScreenshot("story-panel-editing.png");
});

test("story panel with a question", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ai/t/AI-3", "Waiting for you: 1 question");
  await expect(page.getByRole("region", { name: "Activity" })).toBeVisible();
  await page.getByRole("region", { name: "Questions" }).scrollIntoViewIfNeeded();
  await expect(page).toHaveScreenshot("story-panel-question.png");
});

test("agent task page from the story panel", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ai/t/AI-3", "Waiting for you: 1 question");
  await page.getByRole("link", { name: "Agent task · refine" }).click();
  await expect(page.getByRole("heading", { name: "Agent task · refine" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^AI-3: / })).toBeVisible();
  await expect(page).toHaveScreenshot("agent-task-page.png");
});
