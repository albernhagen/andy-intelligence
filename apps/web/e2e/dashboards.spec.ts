import { expect, test, type Page } from "@playwright/test";
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

/** AI-200: a fixed DORA report, so the panel shows its four metrics, not the empty state. */
const dist = (median: number | null, p90: number | null, count: number) => ({ median, p90, count });
const DORA = {
  projectKey: "AI",
  windows: [30, 90].map((days) => ({
    days,
    from: new Date(Date.UTC(2026, 10, 4) - days * 86_400_000).toISOString(),
    to: new Date(Date.UTC(2026, 10, 4)).toISOString(),
    metrics: {
      deployments: days === 30 ? 18 : 51,
      deployFrequency:
        days === 30 ? { perDay: 0.6, perWeek: 4.2 } : { perDay: 0.57, perWeek: 3.97 },
      leadTimeHours: dist(null, null, 0),
      changeFailureRate: days === 30 ? 0.111 : 0.098,
      failedDeployments: days === 30 ? 2 : 5,
      timeToRestoreHours: { ...dist(0.75, 1.5, days === 30 ? 2 : 5), open: 0 },
      ignored: 0,
    },
  })),
  leadTimeMeasured: false,
  latestGood: { gitSha: "b".repeat(40), finishedAt: "2026-11-03T18:00:00.000Z" },
  partial: false,
};

/** Where every chart draws: surfaces, legends and axis ticks, rounded to whole pixels. */
const chartLayout = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".recharts-surface, .recharts-legend-wrapper, .recharts-cartesian-axis-tick",
      ),
    ]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map(Math.round).join(",");
      })
      .join(";"),
  );

/**
 * AI-274: the charts lay out in two passes (ResponsiveContainer measures its box, then Recharts
 * measures the legend and shrinks the plot). A full-page capture resizes the page while it
 * shoots, so on a busy runner a chart could settle with the plot sized for a two-line legend
 * (2% of pixels off). Instead: fonts loaded, the viewport already as tall as the page (the
 * capture resizes nothing), and every chart's layout unchanged across several frames.
 */
async function settleCharts(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // The config's width; only the height grows to the page's.
  const width = page.viewportSize()!.width;
  const pageHeight = () => page.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0; i < 5; i++) {
    const height = await pageHeight();
    if (page.viewportSize()?.height === height) break;
    await page.setViewportSize({ width, height });
  }
  expect(page.viewportSize()?.height, "viewport never matched the page height").toBe(
    await pageHeight(),
  );
  let last = "";
  let same = 0;
  for (let i = 0; i < 50 && same < 3; i++) {
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const now = await chartLayout(page);
    same = now === last ? same + 1 : 0;
    last = now;
  }
  expect(same, "chart layout still moving after 50 frame pairs").toBe(3);
}

test("dashboards: a project's eight weeks", async ({ page }) => {
  await page.route("**/api/projects/ai/dashboard*", (route) => route.fulfill({ json: DASHBOARD }));
  await page.route("**/api/projects/ai/dora", (route) => route.fulfill({ json: DORA }));
  await page.goto("/p/ai/dashboards");
  await expect(page.getByRole("region", { name: "Most expensive agent tasks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Needs you 6" })).toBeVisible();
  await expect(page.getByText("18 deployments")).toBeVisible();
  // AI-257: the Paid spend panel has loaded (the fake ledger is empty, so $0.00).
  const spend = page.getByRole("region", { name: "Paid spend" });
  await expect(spend.getByRole("row", { name: /^All projects/ })).toBeVisible();
  await expect(spend.getByText("No paid spend this month.")).toBeVisible();
  await settleCharts(page);
  await expect(page).toHaveScreenshot("dashboards.png");
});
