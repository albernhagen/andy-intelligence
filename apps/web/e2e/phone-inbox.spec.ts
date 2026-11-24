import { expect, test } from "@playwright/test";
import { expectPageFits } from "./phone";

/**
 * AI-174: M7.4: Phone inbox — the Needs-you inbox at iPhone width (390×844). Answers are
 * intercepted, not sent: the fake API is shared by every spec, so its seed must not change.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("phone inbox: busy project", async ({ page }) => {
  await page.goto("/p/ops/inbox");
  await expect(page.getByText("Delete the old bucket too?").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Needs you 5" })).toBeVisible();
  const overflow = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    return main.scrollWidth - main.clientWidth;
  });
  expect(overflow).toBe(0);
  // The page content only: the shell has its own phone screenshots (AI-173: M7.3: Phone shell).
  // A capture taller than the screen is stitched, and the fixed bottom bar would land mid-page.
  await page.addStyleTag({ content: "nav[aria-label=Main] { display: none !important; }" });
  await expectPageFits(page);
  await expect(page.locator("main section").first()).toHaveScreenshot("phone-inbox-busy.png");
});

test("phone inbox: answer a question with one tap and with typed text", async ({ page }) => {
  const answers: unknown[] = [];
  await page.route("**/api/questions/*/answer", async (route) => {
    answers.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  await page.goto("/p/ops/inbox");
  const question = page.getByRole("listitem", {
    name: "Question: Can the old alert rule be deleted?",
  });
  const yes = question.getByRole("button", { name: "Yes" });
  expect((await yes.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await yes.tap();
  await expect.poll(() => answers.length).toBe(1);

  // Another card: an answered question leaves the list until the refetch brings it back (the
  // answer was intercepted), so typing into the same one would race that re-render.
  const other = page.getByRole("listitem", { name: "Question: Keep backups for 7 or 30 days?" });
  const field = other.getByRole("textbox", { name: "Your answer" });
  expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
  await field.fill("Keep it until Friday");
  await other.getByRole("button", { name: "Answer" }).tap();
  await expect.poll(() => answers.length).toBe(2);
  expect(answers).toEqual([{ answer: "Yes" }, { answer: "Keep it until Friday" }]);
});
