import { expect, test, type Page } from "@playwright/test";
import type { TicketEvent } from "@andy/contracts";

/**
 * AI-194: M7.15: Gated PRs from the phone. At 390 px, a ticket whose PR is open shows "Open in
 * GitHub" (ADR-0115 Q5, option a): a 44 px target to the PR on github.com, clear of the app
 * header, the panel's status line and the bottom bar. The seed links no PRs, so the ticket's
 * history response gets one added; no screenshot, so the shared images don't change.
 */

const SEED_NOW = new Date("2026-11-04T15:00:00.000Z");
const PR_URL = "https://github.com/albernhagen/andy-intelligence/pull/88";

test.use({ viewport: { width: 390, height: 844 } });

async function linkPr(page: Page, state: "open" | "merged") {
  await page.route("**/api/projects/ai/tickets/*/events", async (route) => {
    const response = await route.fetch();
    const events = (await response.json()) as TicketEvent[];
    const ticketId = events[0]?.ticketId ?? "t";
    const linked: TicketEvent = {
      id: "e-pr",
      ticketId,
      kind: "pr_linked",
      actor: "system",
      runId: null,
      body: null,
      data: { number: 88, url: PR_URL, state },
      createdAt: "2026-11-04T14:58:00.000Z",
    };
    await route.fulfill({ response, json: [...events, linked] });
  });
}

test("phone: an open PR shows Open in GitHub, clear of the bars", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await linkPr(page, "open");
  await page.goto("/p/ai/t/AI-7");
  const panel = page.getByRole("dialog", { name: /^AI-7: / });
  const link = panel.getByRole("link", { name: "Open in GitHub" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", PR_URL);
  await expect(link).toHaveAttribute("target", "_blank");

  const box = (await link.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // Below the app header and the panel's sticky status line.
  const header = (await page.locator("header").boundingBox())!;
  const status = (await panel.getByRole("status", { name: "Status" }).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
  expect(box.y).toBeGreaterThanOrEqual(status.y + status.height);
  // Nothing (the bottom bar included) sits on top of it: a tap at its centre reaches the link.
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("a")?.textContent ?? null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hit).toBe("Open in GitHub");
});

test("phone: a merged PR shows no link", async ({ page }) => {
  await page.clock.setFixedTime(SEED_NOW);
  await linkPr(page, "merged");
  await page.goto("/p/ai/t/AI-7");
  const panel = page.getByRole("dialog", { name: /^AI-7: / });
  await expect(panel.getByRole("status", { name: "Status" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open in GitHub" })).toHaveCount(0);
});
