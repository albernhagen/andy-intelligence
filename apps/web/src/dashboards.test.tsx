import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { RunMetrics } from "@andy/contracts";
import { renderApp } from "@/test/harness";

/** AI-117: M4.10: Dashboards screen, over the real API in-process (AI-102's read). */

const ROUTE = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;
const USAGE = {
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 4,
  wallMs: 1,
};
const METRICS: RunMetrics = {
  ciGreenFirstTry: true,
  reviewFailures: ["adversarial-review@abc"],
  reviewBlockers: 1,
  andyCommits: 0,
  reworks: 0,
  costEstimateUsd: 1.5,
};

type Harness = ReturnType<typeof renderApp>;

async function finish(
  h: Harness,
  projectId: string,
  ticketId: string,
  step: "build" | "refine",
  over: object,
) {
  const r = await h.runs.create({ projectId, ticketId, step, route: ROUTE, tier: null });
  await h.runs.update(r.id, { status: "succeeded", endedAt: new Date().toISOString(), ...over }, [
    "queued",
  ]);
  return r;
}

/** A project with a ticket done (with one rework), and three finished agent tasks. */
async function seedProject(h: Harness, key: string, costUsd: number) {
  const projectId = key.toLowerCase();
  await h.tracker.createProject({ name: key, key });
  const t = await h.tracker.createTicket(projectId, { title: "Ships", size: "M" }, "andy");
  for (const stage of ["ready", "in_progress", "ready_for_review", "in_progress"] as const)
    await h.service.move(projectId, t.id, stage, "andy", { force: true });
  await h.service.move(projectId, t.id, "done", "andy", { force: true });
  await h.tracker.createTicket(projectId, { title: "Waits" }, "andy");
  const build = await finish(h, projectId, t.id, "build", {
    costUsd,
    usage: USAGE,
    metrics: METRICS,
  });
  await finish(h, projectId, t.id, "refine", { costUsd: 0.5, usage: USAGE });
  await finish(h, projectId, t.id, "build", { costUsd: null, usage: null });
  return { ticket: t, build };
}

async function open(path: string, seed: (h: Harness) => Promise<unknown>) {
  const requests: string[] = [];
  // Seed first, then open the page, so its one read sees everything (it is not polled).
  const h = renderApp("/projects", {
    beforeFetch: async (req) => {
      if (req.url.includes("dashboard")) requests.push(new URL(req.url).search);
    },
  });
  const seeded = await seed(h);
  await h.router.navigate({ href: path });
  return { h, requests, seeded };
}

const region = (name: string) => screen.findByRole("region", { name });

describe("dashboards page", () => {
  it("GivenAProjectScreen_WhenAndyClicksDashboards_ThenTheDashboardOpens", async () => {
    const { h } = await open("/p/ai", (h) => seedProject(h, "AI", 1.5));
    await h.user.click(await screen.findByRole("link", { name: "Dashboards" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/p/ai/dashboards"));
    expect(screen.getByRole("link", { name: "Dashboards" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("GivenATicketDoneWithRework_WhenTheProjectDashboardOpens_ThenTheDeliveryChartsShowIt", async () => {
    await open("/p/ai/dashboards", (h) => seedProject(h, "AI", 1.5));

    const stages = await region("Tickets by stage");
    expect(stages.querySelectorAll(".recharts-bar-rectangle").length).toBeGreaterThan(0);
    expect(within(stages).getByText("Done")).toBeTruthy();
    for (const name of ["Lead time", "Rework and review blockers", "CI green on first try"]) {
      expect((await region(name)).querySelector(".recharts-surface")).not.toBeNull();
    }
    expect(
      within(await region("CI green on first try")).getByText(/1 of 1 PRs green/),
    ).toBeTruthy();
  });

  it("GivenFinishedAgentTasks_WhenTheProjectDashboardOpens_ThenCostChartsAndTheExpensiveTableShow", async () => {
    const { h, seeded } = await open("/p/ai/dashboards", (h) => seedProject(h, "AI", 1.5));
    const { build } = seeded as Awaited<ReturnType<typeof seedProject>>;

    const cost = await region("Cost");
    expect(cost.textContent).toContain("3 agent tasks · $2.00 estimated · 1 with unknown cost");
    for (const name of ["Cost (USD, estimate)", "Tokens", "Weekly quota used (points)"]) {
      expect(
        within(cost).getByRole("region", { name }).querySelector(".recharts-surface"),
      ).not.toBeNull();
    }
    expect(within(cost).getAllByText("build").length).toBeGreaterThan(0);
    await h.user.click(within(cost).getByRole("button", { name: "By size" }));
    expect(within(cost).queryAllByText("build")).toHaveLength(0);
    expect(within(cost).getAllByText("M").length).toBeGreaterThan(0);

    const expensive = await region("Most expensive agent tasks");
    const links = within(expensive).getAllByRole("link", { name: /^Agent task · / });
    expect(links.map((l) => l.textContent)).toEqual(["Agent task · build", "Agent task · refine"]);
    expect(links[0]!.getAttribute("href")).toBe(`/p/ai/runs/${build.id}`);
    expect(within(expensive).getByText("$1.50")).toBeTruthy();
  });

  it("GivenTwoProjects_WhenAllProjectsDashboardOpens_ThenTotalsAndAPerProjectBreakdown", async () => {
    await open("/all/dashboards", async (h) => {
      await seedProject(h, "AI", 1.5);
      await seedProject(h, "BB", 3);
    });

    expect((await region("Cost")).textContent).toContain("6 agent tasks · $5.50 estimated");
    const rows = within(await region("By project"))
      .getAllByRole("row")
      .slice(1);
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual(["AI", "BB"]);
    expect(within(rows[1]!).getByText("$3.50")).toBeTruthy();
    expect(within(rows[1]!).getByRole("link").getAttribute("href")).toBe("/p/bb/dashboards");
  });

  it("GivenMoreTicketsThanTheReadCap_WhenTheDashboardOpens_ThenTheChartSaysPartial", async () => {
    await open("/p/ai/dashboards", async (h) => {
      await h.tracker.createProject({ name: "AI", key: "AI" });
      for (let i = 0; i < 201; i++) await h.tracker.createTicket("ai", { title: `T${i}` }, "andy");
    });

    const stages = await region("Tickets by stage");
    expect(within(stages).getByText("Partial: a read cap was reached")).toBeTruthy();
    expect(within(await region("Most expensive agent tasks")).queryByText(/Partial/)).toBeNull();
  });

  it("GivenAnEmptyProject_WhenTheDashboardOpens_ThenAnEmptyStateNotCharts", async () => {
    await open("/p/ai/dashboards", (h) => h.tracker.createProject({ name: "AI", key: "AI" }));
    expect(await screen.findByText(/No tickets or agent tasks in these weeks/)).toBeTruthy();
    expect(document.querySelector(".recharts-surface")).toBeNull();
  });

  it("GivenTheWeekPicker_WhenAndyPicksFourWeeks_ThenTheDashboardReloadsForFourWeeks", async () => {
    const { h, requests } = await open("/p/ai/dashboards", (h) => seedProject(h, "AI", 1.5));
    await region("Tickets by stage");
    expect(requests.at(-1)).toBe("?weeks=8");
    expect(screen.getByRole("button", { name: "8 weeks" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await h.user.click(screen.getByRole("button", { name: "4 weeks" }));
    await waitFor(() => expect(requests.at(-1)).toBe("?weeks=4"));
  });
});
