import { expect, test, type Page, type Route } from "@playwright/test";
import type { Run } from "@andy/contracts";
import { expectPageFits } from "./phone";

/**
 * AI-175: M7.5: Phone ticket detail. A ticket and its agent task page at 390 px. The seed's only
 * build task (AI-7: Run cost on cards) is still running, so its responses are rewritten into a
 * finished task with a report, cost and checks; everything else is the seeded fake API. The
 * images hold the ticket panel and the task page only, not the shell header (AI-173: M7.3: Phone
 * shell owns that).
 */

const SEED_NOW = new Date("2026-11-04T15:00:00.000Z");

test.use({ viewport: { width: 390, height: 844 } });

function finished(run: Run): Run {
  return {
    ...run,
    status: "succeeded",
    createdAt: "2026-11-04T14:48:00.000Z",
    endedAt: "2026-11-04T14:58:00.000Z",
    tokensIn: 182_400,
    tokensOut: 9_800,
    costUsd: 1.42,
    costIsEstimate: true,
    usage: {
      inputTokens: 182_400,
      outputTokens: 9_800,
      cacheReadTokens: 640_000,
      cacheWriteTokens: 48_000,
      turns: 31,
      wallMs: 610_000,
    },
    quotaDelta: { "5h": 4, weekly: 1 },
    links: { pullRequest: "https://github.com/albernhagen/andy-intelligence/pull/88" },
    summary:
      "Cards show each ticket's agent task cost.\nSee https://github.com/albernhagen/andy-intelligence/blob/main/apps/web/src/components/BoardCard.tsx for the marker.",
    wouldAutoMerge: false,
    gateReasons: ["checks_pending"],
    verification: [{ command: "pnpm --filter @andy/web test", passed: true, output: "ok" }],
  };
}

/** Rewrites the seeded running build task in a runs list or a single-task response. */
async function finishRuns(page: Page) {
  const rewrite = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Run | Run[];
    const patch = (r: Run) => (r.step === "build" ? finished(r) : r);
    await route.fulfill({ response, json: Array.isArray(body) ? body.map(patch) : patch(body) });
  };
  await page.route("**/api/projects/ai/tickets/*/runs", rewrite);
  await page.route("**/api/projects/ai/runs/*", rewrite);
}

/** The ticket panel never scrolls sideways; code blocks may scroll inside themselves. */
async function expectNoSidewaysScroll(page: Page, selector: string) {
  const { scrollWidth, clientWidth } = await page
    .locator(selector)
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test("phone: a ticket with a finished agent task", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await finishRuns(page);
  await page.goto("/p/ai/t/AI-7");
  const panel = page.getByRole("dialog", { name: /^AI-7: / });
  await expect(panel.getByText("Agent task · build")).toBeVisible();
  await expect(page.getByRole("link", { name: "Needs you 6" })).toBeVisible();
  // Full width, status line first.
  const box = (await panel.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(390);
  await expect(panel.getByRole("status", { name: "Status" })).toBeInViewport();
  await panel.getByRole("region", { name: "Activity" }).scrollIntoViewIfNeeded();
  await expectNoSidewaysScroll(page, "[role=dialog]");
  await expectPageFits(page);
  await expect(panel).toHaveScreenshot("phone-ticket.png");
});

test("phone: the finished agent task's page", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await finishRuns(page);
  await page.goto("/p/ai/t/AI-7");
  await page.getByRole("link", { name: "Agent task · build" }).click();
  await expect(page.getByRole("heading", { name: "Agent task · build" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^AI-7: / })).toBeVisible();
  await expectNoSidewaysScroll(page, "main");
  await expectPageFits(page);
  await expect(page.getByRole("article", { name: "Agent task" })).toHaveScreenshot(
    "phone-agent-task.png",
  );
});
