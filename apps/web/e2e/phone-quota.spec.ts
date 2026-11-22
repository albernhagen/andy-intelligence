import { expect, test } from "@playwright/test";

/**
 * AI-176: M7.6: Phone quota banner and pause. At 390 px the quota banner fits without sideways
 * scroll, and dispatch pauses and resumes from the inbox in one tap each (the ticket allows two).
 * No screenshot: the phone shell (AI-173) still changes the header. It flips project OPS, not AI:
 * every flip lands in the settings change log (AI-118), and AI's settings page is a screenshot.
 * The banner shows only at warn or pause (AI-328), so this test serves a warn reading.
 */

test.use({ viewport: { width: 390, height: 844 } });

const reading = (name: "5h" | "weekly", usedPct: number, level: "ok" | "warn") => ({
  window: name,
  freshness: "fresh",
  level,
  usedPct,
  resetsAt: null,
  takenAt: "2026-11-04T15:00:00.000Z",
  source: "e2e",
});
const WARN = {
  provider: "claude-sub",
  warnPct: 70,
  pausePct: 80,
  level: "warn",
  windows: [reading("5h", 74, "warn"), reading("weekly", 31, "ok")],
};

test("phone: quota banner fits and pause is one tap from the inbox", async ({ page }) => {
  await page.route("**/api/quota", (route) => route.fulfill({ json: WARN }));
  await page.goto("/p/ops/inbox");
  const banner = page.getByRole("alert").filter({ hasText: "Claude quota" });
  await expect(banner).toBeVisible();
  const fits = await banner.evaluate(
    (el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= 390,
  );
  expect(fits).toBe(true);

  await page.getByRole("button", { name: "Pause dispatch for Ops" }).click();
  const resume = page.getByRole("button", { name: "Resume dispatch for Ops" });
  await expect(resume).toHaveAttribute("aria-pressed", "true");
  // Resume, so OPS is unpaused again for the screenshot checks that follow.
  await resume.click();
  await expect(page.getByRole("button", { name: "Pause dispatch for Ops" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
