import { expect, test, type Page } from "@playwright/test";
import { cancelDrag, holdMidDrag } from "./drag";
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

test("GivenThePhoneBoard_WhenAViewIsPicked_ThenTheUrlKeepsItAndOptionsHoldTheRestWithACount", async ({
  page,
}) => {
  await openBoard(page);
  await expect(page.getByRole("group", { name: "Work view" })).toHaveCount(0);
  await page.getByRole("combobox", { name: /^View / }).click();
  await page.getByRole("option", { name: /^Agents/ }).click();
  await expect(page).toHaveURL(/view=agents/);
  await expect(page.getByRole("switch", { name: "Group by epic" })).toBeHidden();
  await page.getByRole("button", { name: "Options" }).click();
  await expect(page.getByRole("switch", { name: "Group by epic" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ideate" })).toBeVisible();
  // A filter on still shows once Options closes: its count on the button.
  await page.getByRole("switch", { name: "Group by epic" }).click();
  await page.getByRole("button", { name: "Options" }).click();
  await expect(page.getByRole("switch", { name: "Group by epic" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Options, 1 on" })).toBeVisible();
});

/** AI-396: on a phone too, the dragged card stays under the finger and fits the screen. */
test("GivenThePhoneBoard_WhenACardIsDragged_ThenItsCopyShowsUnderThePointer", async ({ page }) => {
  await openBoard(page);
  await holdMidDrag(page, page.locator('[data-ticket="AI-3"]'), 20, 90);
  await expect(page.locator("[data-drag-overlay]")).toBeVisible();
  await expectPageFits(page);
  await expect(page).toHaveScreenshot("phone-board-drag.png");
  await cancelDrag(page);
});

/** AI-400: at 390 px, Ideas grouped by milestone and epic, the parked group collapsed. */
test("GivenThePhoneBoard_WhenBacklogShowsIdeas_ThenTheyAreGroupedAndFit", async ({ page }) => {
  await page.goto("/p/ops");
  await stages(page)
    .getByRole("button", { name: /^Backlog/ })
    .click();
  await expect(page.locator('[data-idea-group][data-label="M2: Backups"] button')).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expectTouchTargets(page.locator("section[data-stage]"));
  await expectPageFits(page);
  await expect(page).toHaveScreenshot("phone-board-ideas.png");
});

/** AI-400: on a phone the filter box sits under Options and narrows the lane as you type. */
test("GivenThePhoneBoard_WhenTheFilterBoxHasText_ThenOnlyMatchesShow", async ({ page }) => {
  await page.goto("/p/ops");
  await stages(page)
    .getByRole("button", { name: /^Backlog/ })
    .click();
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("searchbox", { name: "Filter tickets" }).fill("restore");
  await expect(page).toHaveURL(/q=restore/);
  await expect(page.getByText("Rotate backup keys")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Options, 1 on" })).toBeVisible();
  await expectPageFits(page);
  await expect(page).toHaveScreenshot("phone-board-filter.png");
});
