import { expect, test, type Page } from "@playwright/test";
import { Run, type EpicBreakdown, type WaitingEpicBreakdown } from "@andy/contracts";
import { DEFAULT_ROUTE } from "@andy/domain";
import { expectPageFits, expectTouchTargets } from "./phone";
import { expectShellLoaded } from "./shell";

/**
 * AI-383: epic breakdowns. The seed's OPS-5 has no breakdown and a parked milestone, so the
 * stored epic panel images show "Draft tickets" disabled with its reason. Here its reads are
 * rewritten (the shared fake API's seed must not change): a plan-epic task drafting, a waiting
 * draft on the panel, and the inbox's "Epic breakdowns" section, at 1280 and 390 px.
 */

const SEED_NOW = new Date("2026-11-04T15:00:00.000Z");
const AT = "2026-11-04T14:50:00.000Z";
const EPIC_ID = "00000000-0000-4000-8000-000000000005";

const breakdown: EpicBreakdown = {
  projectId: "ops",
  epicId: EPIC_ID,
  status: "proposed",
  proposal: {
    summary:
      "Prove a restore first, then alert on failures, then copy backups to a second region. Three tickets; the alert waits on the drill so it can reuse its check.",
    tickets: [
      {
        title: "Monthly restore drill",
        type: "chore",
        size: "S",
        sizeReason: "One scheduled job and a log line.",
        body: "Restore last night's snapshot into a scratch database each month and record how long it took.",
        acceptanceCriteria: ["A restore runs on the first of each month", "Its duration is logged"],
        touches: ["infra/backup", "ops/runbooks/restore.md"],
        blockedBy: [],
      },
      {
        title: "Alert when a backup fails",
        type: "feature",
        size: "M",
        sizeReason: "A new alert rule plus its runbook.",
        body: "Page the on-call channel when a nightly backup or the restore drill fails.",
        acceptanceCriteria: ["A failed backup alerts within 15 minutes"],
        touches: ["infra/alerts"],
        blockedBy: [0],
      },
      {
        title: "Copy backups to a second region",
        type: "chore",
        size: "M",
        sizeReason: "Bucket replication and its IAM.",
        body: "Replicate the backup bucket to a second region.",
        acceptanceCriteria: ["Each snapshot exists in both regions"],
        touches: ["infra/backup"],
        blockedBy: [],
      },
    ],
  },
  proposedBy: "agent",
  proposedAt: AT,
  decidedBy: null,
  decidedAt: null,
  reason: null,
  ticketIds: [],
  approvalLeaseUntil: null,
  updatedAt: AT,
};

const drafting = Run.parse({
  id: "00000000-0000-4000-8000-0000000000aa",
  projectId: "ops",
  ticketId: EPIC_ID,
  step: "plan-epic",
  route: DEFAULT_ROUTE,
  tier: "strong",
  status: "running",
  startedAt: AT,
  endedAt: null,
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  costIsEstimate: false,
  quotaSnapshot: null,
  links: {},
  outcome: null,
  wouldAutoMerge: null,
  createdAt: AT,
});

const waiting: WaitingEpicBreakdown[] = [
  {
    projectId: "ops",
    projectKey: "OPS",
    epicId: EPIC_ID,
    epicKey: "OPS-5",
    epicTitle: "Backups you can trust",
    breakdown,
  },
];

/** OPS-5's milestone reads as approved, so the panel is the one a breakdown can run on. */
async function approveMilestone(page: Page) {
  await page.route("**/api/projects/ops/milestones", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { status: string }[];
    await route.fulfill({ response, json: body.map((m) => ({ ...m, status: "approved" })) });
  });
}

async function withBreakdown(page: Page, value: EpicBreakdown | null) {
  await page.route("**/api/projects/ops/tickets/*/breakdown", (route) =>
    route.fulfill({ json: { breakdown: value } }),
  );
}

async function openPanel(page: Page) {
  await page.clock.setFixedTime(SEED_NOW);
  await page.goto("/p/ops/t/OPS-5");
  const panel = page.getByRole("dialog", { name: /^OPS-5: / });
  const section = panel.getByRole("region", { name: "Breakdown" });
  await expect(section).toBeVisible();
  await expectShellLoaded(page);
  return section;
}

test.describe("desktop", () => {
  test("epic panel: a plan-epic task drafting", async ({ page }) => {
    await approveMilestone(page);
    await withBreakdown(page, null);
    await page.route("**/api/projects/ops/tickets/*/runs", (route) =>
      route.fulfill({ json: [drafting] }),
    );
    const section = await openPanel(page);
    await expect(section.getByRole("link", { name: "Agent task · plan-epic" })).toBeVisible();
    await expect(page).toHaveScreenshot("epic-breakdown-drafting.png");
  });

  test("epic panel: a draft waiting for Andy", async ({ page }) => {
    await approveMilestone(page);
    await withBreakdown(page, breakdown);
    const section = await openPanel(page);
    await expect(section.getByRole("button", { name: "Approve: create 3 tickets" })).toBeVisible();
    await expect(section).toHaveScreenshot("epic-breakdown-waiting.png");
  });

  test("inbox: an epic breakdown waiting", async ({ page }) => {
    await page.route("**/api/epic-breakdowns/waiting", (route) => route.fulfill({ json: waiting }));
    await page.goto("/p/ops/inbox");
    const section = page.getByRole("region", { name: "Epic breakdowns" });
    await expect(section.getByText("3 tickets drafted, waiting for you")).toBeVisible();
    await expect(page.getByText("Delete the old bucket too?").first()).toBeVisible();
    await expectShellLoaded(page);
    await expect(page).toHaveScreenshot("inbox-epic-breakdowns.png");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("phone epic panel: a draft waiting for Andy", async ({ page }) => {
    await approveMilestone(page);
    await withBreakdown(page, breakdown);
    const section = await openPanel(page);
    await expect(section.getByRole("button", { name: "Send back" })).toBeVisible();
    await expectPageFits(page);
    await expectTouchTargets(section);
    await expect(section).toHaveScreenshot("phone-epic-breakdown-waiting.png");
  });

  test("phone inbox: an epic breakdown waiting", async ({ page }) => {
    await page.route("**/api/epic-breakdowns/waiting", (route) => route.fulfill({ json: waiting }));
    await page.goto("/p/ops/inbox");
    const section = page.getByRole("region", { name: "Epic breakdowns" });
    await expect(section.getByText("3 tickets drafted, waiting for you")).toBeVisible();
    await expectPageFits(page);
    await expectTouchTargets(section);
    await page.addStyleTag({ content: "nav[aria-label=Main] { display: none !important; }" });
    await expect(page.locator("main section").first()).toHaveScreenshot(
      "phone-inbox-epic-breakdowns.png",
    );
  });
});
