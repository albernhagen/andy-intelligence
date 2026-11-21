import { expect, test } from "@playwright/test";

/**
 * AI-176: M7.6: Phone quota banner and pause. At 390 px the quota banner fits without sideways
 * scroll, and dispatch pauses and resumes from the inbox in one tap each (the ticket allows two).
 * No screenshot: the phone shell (AI-173) still changes the header.
 */

test.use({ viewport: { width: 390, height: 844 } });

test("phone: quota banner fits and pause is one tap from the inbox", async ({ page }) => {
  await page.goto("/p/ai/inbox");
  const banner = page.getByRole("status").filter({ hasText: "Claude quota" });
  await expect(banner).toBeVisible();
  const fits = await banner.evaluate(
    (el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= 390,
  );
  expect(fits).toBe(true);

  await page.getByRole("button", { name: "Pause dispatch for Andy Intelligence" }).click();
  const resume = page.getByRole("button", { name: "Resume dispatch for Andy Intelligence" });
  await expect(resume).toHaveAttribute("aria-pressed", "true");
  // Resume, so the seeded project is unpaused again for the screenshot checks that follow.
  await resume.click();
  await expect(
    page.getByRole("button", { name: "Pause dispatch for Andy Intelligence" }),
  ).toHaveAttribute("aria-pressed", "false");
});
