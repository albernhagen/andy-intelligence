import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import type { NewDeployment } from "@andy/contracts";
import { duration } from "@/components/DoraPanel";
import { renderApp } from "@/test/harness";

/** AI-200: M6.15: DORA panel on Dashboards, over the real API in-process. */

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const deployment = (days: number, over: Partial<NewDeployment> = {}): NewDeployment => ({
  projectId: "ai",
  environment: "prod",
  imageDigest: `sha256:${"a".repeat(64)}`,
  gitSha: "b".repeat(40),
  kind: "deploy",
  status: "succeeded",
  startedAt: ago(days),
  finishedAt: ago(days),
  actor: "system",
  ...over,
});

async function open(seed: (h: ReturnType<typeof renderApp>) => Promise<unknown>) {
  const h = renderApp("/projects");
  await h.tracker.createProject({ name: "AI", key: "AI" });
  await seed(h);
  await h.router.navigate({ href: "/p/ai/dashboards" });
  return { h, panel: await screen.findByRole("region", { name: "DORA metrics" }) };
}

describe("DORA panel", () => {
  it("GivenNoDeployments_WhenDashboardsOpens_ThenTheEmptyStateShows", async () => {
    const { panel } = await open(async () => {});

    expect(
      await within(panel).findByText(/No production deployments in the last 30 days/),
    ).toBeTruthy();
  });

  it("GivenDeploymentsAndARollback_WhenDashboardsOpens_ThenTheFourMetricsShow", async () => {
    const { panel } = await open(async (h) => {
      const bad = await h.deployments.record(deployment(5));
      await h.deployments.record(
        deployment(4.5, { kind: "rollback", previousDeploymentId: bad.id }),
      );
      await h.deployments.record(deployment(1));
    });

    expect(await within(panel).findByText("Deploy frequency")).toBeTruthy();
    expect(within(panel).getByText("2 deployments")).toBeTruthy();
    expect(within(panel).getByText("Not measured")).toBeTruthy();
    expect(within(panel).getByText("50%")).toBeTruthy();
    expect(within(panel).getByText("1 of 2 rolled back")).toBeTruthy();
    expect(within(panel).getByText("12.0 h")).toBeTruthy();
  });

  it("GivenAnOlderDeployment_WhenAndyPicksNinetyDays_ThenItCounts", async () => {
    const { h, panel } = await open(async (h) => {
      await h.deployments.record(deployment(1));
      await h.deployments.record(deployment(60));
    });

    expect(await within(panel).findByText("1 deployment")).toBeTruthy();
    await h.user.click(within(panel).getByRole("button", { name: "90 days" }));
    expect(await within(panel).findByText("2 deployments")).toBeTruthy();
  });

  it("GivenHours_WhenFormatted_ThenHoursUnderTwoDaysElseDays", () => {
    expect(duration(null)).toBe("–");
    expect(duration(5.5)).toBe("5.5 h");
    expect(duration(72)).toBe("3.0 d");
  });
});
