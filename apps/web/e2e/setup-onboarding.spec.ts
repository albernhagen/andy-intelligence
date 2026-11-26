import { expect, test, type Page } from "@playwright/test";
import { onboardingFixture } from "../src/lib/onboarding-fixture";
import { expectShellLoaded } from "./shell";
import { expectPageFits, expectTouchTargets } from "./phone";
import { mockBriefStep, mockOnboarding } from "./setup-fixtures";

/**
 * AI-381: the setup path's GitHub and terminal steps at 1280 px (light and dark) and 390 px: a
 * hand step with its commands, link and Mark done, a live step the App couldn't read, and the
 * repo limits naming what fails. Beside setup.spec.ts (AI-373's approve step).
 */

const SEED_NOW = new Date("2026-11-04T15:00:00.000Z");

/** The reviewer token step is current: everything before it done, it waits for a mark. */
const AT_REVIEWER_TOKEN = onboardingFixture(
  {
    reviewer_token: "not_yet",
    agent_environment: "not_yet",
    proving_refine: "not_yet",
    builds_on: "not_yet",
  },
  { marked: ["reusable_workflows"] },
);

async function openStep(page: Page, onboarding = AT_REVIEWER_TOKEN, heading = "Reviewer token") {
  await page.clock.setFixedTime(SEED_NOW);
  await mockBriefStep(page);
  await mockOnboarding(page, onboarding);
  await page.goto("/p/ai/setup");
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expectShellLoaded(page);
}

test("setup: hand step at desktop", async ({ page }) => {
  await openStep(page);
  await expect(
    page.getByText("gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo albernhagen/widgets"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Open Actions secrets/ })).toHaveAttribute(
    "href",
    "https://github.com/albernhagen/widgets/settings/secrets/actions",
  );
  await expect(page).toHaveScreenshot("setup-hand-step.png");
});

test("setup: hand step dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openStep(page);
  await expect(page).toHaveScreenshot("setup-hand-step-dark.png");
});

test("setup: hand step on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStep(page);
  await expectPageFits(page);
  await expectTouchTargets(page.locator('section[aria-labelledby^="step-"]'));
  await expect(page).toHaveScreenshot("phone-setup-hand-step.png", { fullPage: true });
});

test("setup: unreadable live step and failing limits", async ({ page }) => {
  await openStep(
    page,
    onboardingFixture(
      {
        repo_settings: "unknown",
        reusable_workflows: "not_yet",
        reviewer_token: "not_yet",
        agent_environment: "not_yet",
        proving_refine: "not_yet",
        builds_on: "not_yet",
      },
      { failingLimits: true },
    ),
    "Apply the repo settings",
  );
  await expect(page.getByText("The repo fails 2 limits")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Mark done/ })).toBeVisible();
  await expect(page).toHaveScreenshot("setup-unknown-step.png");
});
