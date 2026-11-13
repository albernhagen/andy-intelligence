import { expect, test } from "@playwright/test";
import type { DashboardCost, DashboardWeek, ProjectDashboard, RunStep } from "@andy/contracts";

/**
 * AI-117: M4.10: Dashboards screen. The dashboard read uses the server's real clock, so its
 * weeks would move; the screenshot serves this fixed eight-week dashboard instead. Everything
 * else (shell, header count) comes from the seeded fake API.
 */

const STEPS: RunStep[] = ["refine", "plan", "build", "review", "verify", "scout", "sync"];

const cost = (runs: number, usd: number, quota: number | null): DashboardCost => ({
  runs,
  unknownCostRuns: runs > 3 ? 1 : 0,
  estimatedCostUsd: usd,
  tokensIn: Math.round(usd * 90_000),
  tokensOut: Math.round(usd * 9_000),
  turns: runs * 12,
  quotaDelta: { "5h": quota, weekly: quota === null ? null : quota / 4 },
});

function week(i: number): DashboardWeek {
  const start = new Date(Date.UTC(2026, 8, 14 + 7 * i)).toISOString();
  const end = new Date(Date.UTC(2026, 8, 21 + 7 * i)).toISOString();
  const build = cost(2 + (i % 3), 1.2 + i * 0.4, 6 + i);
  const refine = cost(1 + (i % 2), 0.3 + i * 0.05, 2);
  const review = cost(1, 0.2, 1);
  const byStep = STEPS.map((step) => {
    const c = { build, refine, review }[step as "build"] ?? cost(0, 0, null);
    return { ...c, step };
  });
  const total = cost(
    build.runs + refine.runs + review.runs,
    build.estimatedCostUsd + refine.estimatedCostUsd + review.estimatedCostUsd,
    9 + i,
  );
  return {
    start,
    end,
    ticketsByStage: {
      backlog: 6 + (i % 3),
      ready: 3,
      in_progress: 1 + (i % 2),
      ready_for_review: i % 3 === 0 ? 2 : 1,
      done: 4 + i * 2,
      cancelled: 1,
    },
    leadTimeHours: { median: 6 + (i % 4) * 2, p90: 20 + (i % 3) * 6, count: 2 },
    reworks: i % 3 === 1 ? 2 : i % 2,
    ciGreenFirstTry: { green: 2 + (i % 2), known: 3, rate: (2 + (i % 2)) / 3 },
    reviewBlockers: i % 4 === 2 ? 2 : 0,
    cost: total,
    byStep,
    bySize: [
      { ...cost(build.runs, build.estimatedCostUsd, 6 + i), size: "M" },
      { ...cost(refine.runs + review.runs, refine.estimatedCostUsd + 0.2, 3), size: "S" },
      { ...cost(0, 0, null), size: "L" },
      { ...cost(0, 0, null), size: "unsized" },
    ],
  };
}

const weeks = Array.from({ length: 8 }, (_, i) => week(i));
const DASHBOARD: ProjectDashboard = {
  projectId: "ai",
  key: "AI",
  from: weeks[0]!.start,
  to: weeks.at(-1)!.end,
  weeks,
  expensiveRuns: [
    ["AI-7", "build", 4.12],
    ["AI-3", "build", 3.4],
    ["AI-1", "refine", 0.92],
  ].map(([ticketKey, step, costUsd], i) => ({
    id: `run-${i + 1}`,
    projectId: "ai",
    ticketId: `ticket-${i + 1}`,
    ticketKey: ticketKey as string,
    step: step as RunStep,
    costUsd: costUsd as number,
    costIsEstimate: true,
    endedAt: new Date(Date.UTC(2026, 10, 3 - i)).toISOString(),
  })),
  partial: ["reworks"],
};

test("dashboards: a project's eight weeks", async ({ page }) => {
  await page.route("**/api/projects/ai/dashboard*", (route) => route.fulfill({ json: DASHBOARD }));
  await page.goto("/p/ai/dashboards");
  await expect(page.getByRole("region", { name: "Most expensive agent tasks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Needs you 6" })).toBeVisible();
  await expect(page).toHaveScreenshot("dashboards.png", { fullPage: true });
});
