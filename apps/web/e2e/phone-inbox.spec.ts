import { expect, test, type Page } from "@playwright/test";
import { expectPageFits } from "./phone";

/**
 * AI-174: M7.4: Phone inbox — the Needs-you inbox at iPhone width (390×844). AI-371: one
 * decision at a time, with its place in the queue. Answers are intercepted, not sent: the fake
 * API is shared by every spec, so its seed must not change.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

/** Steps the queue from its start until `text`'s question shows; returns that question. */
async function showQuestion(page: Page, text: string) {
  const previous = page.getByRole("button", { name: "Previous" });
  while (await previous.isEnabled()) await previous.tap();
  const question = page.getByRole("listitem", { name: `Question: ${text}` });
  for (let i = 0; i < 10 && !(await question.isVisible()); i++) {
    await page.getByRole("button", { name: "Next" }).tap();
  }
  await expect(question).toBeVisible();
  return question;
}

test("phone inbox: busy project", async ({ page }) => {
  await page.goto("/p/ops/inbox");
  await expect(page.getByText("Ticket 1 of 4")).toBeVisible();
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
  await expect(page.getByText("Ticket 1 of 4")).toBeVisible();
  const question = await showQuestion(page, "Can the old alert rule be deleted?");
  const yes = question.getByRole("button", { name: "Yes" });
  expect((await yes.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await yes.tap();
  await expect.poll(() => answers.length).toBe(1);

  // Another ticket: an answered question leaves until the refetch brings it back (the answer was
  // intercepted), so the queue settles before stepping to the next one.
  await expect(page.getByText(/^Ticket \d of 4/)).toBeVisible();
  const other = await showQuestion(page, "Keep backups for 7 or 30 days?");
  const field = other.getByRole("textbox", { name: "Your answer" });
  expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
  await field.fill("Keep it until Friday");
  await other.getByRole("button", { name: "Answer" }).tap();
  await expect.poll(() => answers.length).toBe(2);
  expect(answers).toEqual([{ answer: "Yes" }, { answer: "Keep it until Friday" }]);
});
