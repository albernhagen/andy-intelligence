import { expect, test } from "@playwright/test";
import { mockDashboards, settleCharts } from "./dashboard-fixtures";

/** AI-117: M4.10: Dashboards screen, over the fixed dashboard in dashboard-fixtures.ts. */

test("dashboards: a project's eight weeks", async ({ page }) => {
  await mockDashboards(page);
  await page.goto("/p/ai/dashboards");
  await expect(page.getByRole("region", { name: "Most expensive agent tasks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Needs you 5" })).toBeVisible();
  await expect(page.getByText("18 deployments")).toBeVisible();
  // AI-257: the Paid spend panel has loaded (the fake ledger is empty, so $0.00).
  const spend = page.getByRole("region", { name: "Paid spend" });
  await expect(spend.getByRole("row", { name: /^All projects/ })).toBeVisible();
  await expect(spend.getByText("No paid spend this month.")).toBeVisible();
  await settleCharts(page);
  await expect(page).toHaveScreenshot("dashboards.png");
});
