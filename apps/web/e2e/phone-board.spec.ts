import { expect, test, type Page } from "@playwright/test";
import { expectPageFits, expectTouchTargets } from "./phone";

/**
 * AI-337: Phone board: one stage at a time. At 390 px the board shows one stage full width under
 * stage tabs with counts, opening on the first stage holding a ticket that needs you.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function openBoard(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-04T15:00:00.000Z"));
  await page.goto("/p/ai");
  await expect(page.getByText("Story side panel").first()).toBeVisible();
}

const stages = (page: Page) => page.getByRole("group", { name: "Stages" });

test("GivenAPhone_WhenTheBoardOpens_ThenTheFirstStageThatNeedsYouShowsFullWidth", async ({
  page,
}) => {
  await openBoard(page);
  // AI-3 in Backlog has an open question: Backlog is the first stage that needs you.
  await expect(stages(page).getByRole("button", { name: "Backlog 3" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("section[data-stage]")).toHaveCount(1);
  const lane = (await page.locator("section[data-stage]").boundingBox())!;
  expect(lane.width).toBeGreaterThan(350);
  const header = (await page.locator("header").boundingBox())!;
  const card = (await page.locator("section[data-stage] li a").first().boundingBox())!;
  expect(card.y - (header.y + header.height)).toBeLessThanOrEqual(250);
  await expectTouchTargets(stages(page));
  await expectTouchTargets(page.locator("main section > div").first());
  await expectPageFits(page);
  await expect(page).toHaveScreenshot("phone-board.png");
});

test("GivenThePhoneBoard_WhenAStageTabIsTapped_ThenThatStageShows", async ({ page }) => {
  await openBoard(page);
  for (const name of ["Ready 2", "Ready for review 2", "Done 2", "In progress 2"]) {
    await stages(page).getByRole("button", { name }).click();
    await expect(page.locator("section[data-stage]")).toHaveCount(1);
    await expectPageFits(page);
  }
  await expect(page.locator("section[data-stage]")).toHaveAttribute("data-stage", "in_progress");
  await expect(page.getByText("Building · 12 min").first()).toBeVisible();
  await expect(page).toHaveScreenshot("phone-board-in-progress.png");
});

test("GivenThePhoneBoard_WhenAViewIsPicked_ThenTheUrlKeepsItAndOptionsHoldTheRest", async ({
  page,
}) => {
  await openBoard(page);
  await expect(page.getByRole("group", { name: "Work view" })).toHaveCount(0);
  await page.getByLabel("View").selectOption("agents");
  await expect(page).toHaveURL(/view=agents/);
  await expect(page.getByRole("checkbox", { name: "Group by epic" })).toBeHidden();
  await page.getByRole("button", { name: "Options" }).click();
  await expect(page.getByRole("checkbox", { name: "Group by epic" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ideate" })).toBeVisible();
});
