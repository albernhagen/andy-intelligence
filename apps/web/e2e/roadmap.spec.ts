import { expect, test, type Page } from "@playwright/test";
import type { ProjectRoadmap, RoadmapCounts, RoadmapEpic } from "@andy/domain";
import { expectPageFits } from "./phone";

/**
 * AI-202: M4.26: Roadmap screen. No write path sets an epic's milestone before AI-304, so the
 * screenshot serves this fixed roadmap; the shell and header count come from the seeded fake API.
 */

const counts = (over: Partial<RoadmapCounts> = {}): RoadmapCounts => ({
  needsYou: 0,
  inReview: 0,
  inProgress: 0,
  blocked: 0,
  notStarted: 0,
  ...over,
});

const epic = (
  key: string,
  title: string,
  state: RoadmapEpic["state"],
  done: number,
  total: number,
  over: Partial<RoadmapCounts> = {},
): RoadmapEpic => ({
  key,
  title,
  outcome: null,
  doneWhen: [],
  stage: state === "done" ? "done" : "backlog",
  state,
  progress: { done, total },
  counts: counts(over),
  children: [],
});

const ROADMAP: ProjectRoadmap = {
  projectId: "ai",
  projectKey: "AI",
  projectName: "Andy Intelligence",
  milestones: [
    {
      id: "m1",
      name: "M1: First end-to-end flow",
      outcome: "A ticket from Claude is refined, built and merged",
      order: 1,
      status: "approved",
      done: true,
      progress: { done: 9, total: 9 },
      counts: counts(),
      epicKeys: ["AI-21"],
    },
    {
      id: "m4",
      name: "M4: Epics + story board",
      outcome: "Epics, the roadmap and work views",
      order: 4,
      status: "approved",
      done: false,
      progress: { done: 23, total: 32 },
      counts: counts({ needsYou: 2, inReview: 3, inProgress: 1, blocked: 4, notStarted: 1 }),
      epicKeys: ["AI-84", "AI-285"],
    },
    {
      id: "m6",
      name: "M6: Dev → prod releases",
      outcome: "Per-project dev and prod deploys with one-click promote",
      order: 6,
      status: "parked",
      done: false,
      progress: { done: 5, total: 20 },
      counts: counts({ inReview: 1, blocked: 13 }),
      epicKeys: ["AI-153"],
    },
    {
      id: "m11",
      name: "M11: Members",
      outcome: "Other people on a project, with roles",
      order: 11,
      status: "not_reviewed",
      done: false,
      progress: { done: 0, total: 0 },
      counts: counts(),
      epicKeys: [],
    },
  ],
  noMilestone: ["AI-140"],
  epics: [
    epic("AI-21", "M1: First end-to-end flow", "done", 9, 9),
    epic("AI-84", "M4: Epics + story board", "in_progress", 23, 32, {
      needsYou: 2,
      inReview: 3,
      inProgress: 1,
      blocked: 4,
      notStarted: 1,
    }),
    epic("AI-285", "Web UI and MCP parity", "not_started", 0, 0),
    epic("AI-153", "M6: Dev → prod releases", "in_progress", 5, 20, { inReview: 1, blocked: 13 }),
    epic("AI-140", "Parallel development without merge conflicts", "in_progress", 12, 16, {
      inReview: 2,
    }),
  ],
  truncated: false,
};

async function open(page: Page) {
  await page.route("**/api/projects/ai/roadmap", (route) => route.fulfill({ json: ROADMAP }));
  await page.goto("/p/ai/roadmap");
  await expect(page.getByRole("button", { name: /^M4: Epics \+ story board/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Needs you 5" })).toBeVisible();
  await page.getByRole("button", { name: /^M4: Epics \+ story board/ }).click();
  await expect(page.getByRole("link", { name: /AI-285/ })).toBeVisible();
}

test("roadmap: milestones with one expanded, parked dimmed, no milestone last", async ({
  page,
}) => {
  await open(page);
  await expect(page).toHaveScreenshot("roadmap.png", { fullPage: true });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("phone roadmap: rows stack", async ({ page }) => {
    await open(page);
    await expectPageFits(page);
    await expect(page).toHaveScreenshot("phone-roadmap.png", { fullPage: true });
  });
});
