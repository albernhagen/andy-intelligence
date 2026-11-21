import { expect, test, type Page } from "@playwright/test";

/**
 * AI-26: screenshot checks for the shell, board, story panel (AI-29), inbox (AI-30), agent task page (AI-101) and project settings (M4.12). A diff fails CI; a deliberate
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

test("board: work view chips, Needs me picked", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ai?view=needs-me", "Sort by score");
  await expect(page.getByRole("button", { name: /^Needs me/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page).toHaveScreenshot("board-work-view.png", { fullPage: true });
});

test("work under All projects, Needs me", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/all/work", "Story side panel");
  await expect(page).toHaveScreenshot("work-all-projects.png", { fullPage: true });
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

test("board grouped by epic", async ({ page }) => {
  await open(page, "/p/ops", "Monthly restore drill");
  await page.getByRole("checkbox", { name: "Group by epic" }).check();
  await expect(page.getByText("1 of 3 done").first()).toBeVisible();
  await expect(page).toHaveScreenshot("board-grouped.png", { fullPage: true });
});

test("agent task page from the story panel", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ai/t/AI-3", "Waiting for you: 1 question");
  await page.getByRole("link", { name: "Agent task · refine" }).click();
  await expect(page.getByRole("heading", { name: "Agent task · refine" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^AI-3: / })).toBeVisible();
  await expect(page).toHaveScreenshot("agent-task-page.png");
});

/** AI-85: the epic's stories in the panel, on the OPS epic AI-86 seeds (OPS-5). */
test("what's new: status, then changes by day, one opened", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ops/whats-new", "Backups now land in a second region");
  await page.getByText("Backups now land in a second region").click();
  await expect(page.getByText("A nightly job copies each snapshot")).toBeVisible();
  await expect(page).toHaveScreenshot("whats-new.png", { fullPage: true });
});

test("story panel for an epic", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ops/t/OPS-5", "1 of 3 done");
  await page.getByRole("region", { name: "Stories" }).scrollIntoViewIfNeeded();
  await expect(page).toHaveScreenshot("story-panel-epic.png");
});

/** AI-282: M9: the rail's Routing section: worker, tier and route with the layer that set each. */
test("ticket panel routing layers", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ai/t/AI-1", "Picking a project should feel like picking a tenant.");
  const routing = page.getByRole("region", { name: "Routing" });
  await expect(routing.getByText("Route", { exact: true })).toBeVisible();
  await routing.scrollIntoViewIfNeeded();
  await expect(routing).toHaveScreenshot("ticket-routing.png");
});

/** AI-298: the ranked Ready list, the same as MCP list_ready. */
test("ready view: ranked list with scores", async ({ page }) => {
  await open(page, "/p/ai/ready", "In board order: the order is the priority.");
  await expect(page.getByRole("list", { name: "Ready tickets" })).toBeVisible();
  await expect(page).toHaveScreenshot("ready-view.png");
});

/** M4.12: AI's settings with the Changes list: a reverted flip and the revert, logged too. */
test("project settings with changes", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await open(page, "/p/ai/settings", "AI: Andy Intelligence settings");
  await expect(page.getByText("Revert of change-flip", { exact: false })).toBeVisible();
  await expect(page).toHaveScreenshot("project-settings-changes.png", { fullPage: true });
});
