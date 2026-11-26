import type { Page } from "@playwright/test";
import type { Onboarding, ProjectPlan } from "@andy/contracts";
import { onboardingFixture } from "../src/lib/onboarding-fixture";

/**
 * AI-373: the setup path's reads for the screenshots. The fake API (e2e/fake-api.ts) has no
 * GitHub connection, so the brief's state is served here; the approve step also gets a proposed
 * plan. Everything else (shell, project, checklist) comes from the seeded fake API.
 */

const PROJECT = "ai";

/** AI-381: the onboarding steps, served as given (the fake API has no GitHub). */
export async function mockOnboarding(page: Page, onboarding: Onboarding) {
  await page.route(`**/api/projects/${PROJECT}/onboarding*`, (route) =>
    route.fulfill({ json: onboarding }),
  );
}

/** Every GitHub and terminal step done; the refine and builds still to come. */
export const HAND_STEPS_DONE = onboardingFixture(
  { proving_refine: "not_yet", builds_on: "not_yet" },
  { marked: ["reusable_workflows", "reviewer_token", "agent_environment"] },
);

export async function mockBriefStep(page: Page) {
  await mockOnboarding(page, HAND_STEPS_DONE);
  await page.route(`**/api/projects/${PROJECT}/brief`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            readable: true,
            onDefaultBranch: false,
            // As discovery's "Brief answers" would pre-fill them.
            prefill: {
              idea: "A personal control plane for agentic software development.",
              problem: "Side projects need more keyboard time than Andy has.",
              users: "Andy only.",
            },
          },
        })
      : route.fallback(),
  );
}

export const PROPOSED_PLAN: ProjectPlan = {
  status: "proposed",
  proposal: {
    summary: "Three milestones, smallest useful slice first.",
    milestones: [
      {
        title: "Sign-in and one imported run",
        goal: "You sign in and see one run pulled from the watch.",
        doneWhen: ["One run shows after sign-in"],
        slices: ["Sign-in", "Watch import", "Run page", "Deploy"],
        case: {
          serves: "Andy, every Monday",
          expectedReturn: "No more copying runs by hand.",
          cheapestTest: "Import last week's runs once.",
        },
      },
      {
        title: "Weekly summary",
        goal: "Monday view with distance and climb for last week.",
        doneWhen: ["Last week's totals show on Monday"],
        slices: ["Totals", "Week picker", "Climb", "Empty week", "Phone layout"],
      },
      {
        title: "Share with friends",
        goal: "Invite a friend who sees their own runs.",
        doneWhen: ["A friend signs in and sees only their runs"],
        slices: ["Invites", "Per-user data", "Sharing page", "Limits", "Email", "Docs"],
      },
    ],
  },
  proposedBy: "agent:run-1",
  proposedAt: "2026-11-04T14:00:00.000Z",
  decidedBy: null,
  decidedAt: null,
  reason: null,
  epicIds: [],
};

/** The approve step: the brief merged and a plan waiting. */
export async function mockApproveStep(page: Page) {
  await mockOnboarding(page, HAND_STEPS_DONE);
  await page.route(`**/api/projects/${PROJECT}/brief`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { readable: true, onDefaultBranch: true, prefill: {} } })
      : route.fallback(),
  );
  await page.route(`**/api/projects/${PROJECT}/plan`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { plan: PROPOSED_PLAN } })
      : route.fallback(),
  );
}
