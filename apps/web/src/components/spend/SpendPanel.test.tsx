import { afterEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { EffectiveSpendCaps } from "@andy/contracts";
import { PAGE_LOAD, renderApp } from "@/test/harness";
import { SpendUsed, spendRows } from "./SpendPanel";

/** AI-257: M10.9: the Paid spend panel on Dashboards. */

const USD = 1_000_000;
const CAPS: EffectiveSpendCaps = {
  per_task: 2 * USD,
  project_daily: 5 * USD,
  project_monthly: 50 * USD,
  global_daily: 10 * USD,
  global_monthly: 100 * USD,
};
const spent = (pd: number, pm: number, gd: number, gm: number) => ({
  project: { dayMicroUsd: pd, monthMicroUsd: pm },
  global: { dayMicroUsd: gd, monthMicroUsd: gm },
});

afterEach(() => window.localStorage.clear());

describe("spendRows", () => {
  it("GivenTwoProjects_WhenRowsBuilt_ThenOneEachThenAllProjectsFromTheGlobalTotals", () => {
    const rows = spendRows([
      { key: "AI", effective: CAPS, spent: spent(1 * USD, 2 * USD, 3 * USD, 4 * USD) },
      { key: "WEB", effective: { ...CAPS, project_daily: USD }, spent: null },
    ]);
    expect(rows).toEqual([
      { label: "AI", day: 1 * USD, dayCap: 5 * USD, month: 2 * USD, monthCap: 50 * USD },
      { label: "WEB", day: null, dayCap: USD, month: null, monthCap: 50 * USD },
      {
        label: "All projects",
        day: 3 * USD,
        dayCap: 10 * USD,
        month: 4 * USD,
        monthCap: 100 * USD,
      },
    ]);
  });

  it("GivenNoProjectKnowsItsSpend_WhenRowsBuilt_ThenAllProjectsIsUnknownToo", () => {
    expect(spendRows([{ key: "AI", effective: CAPS, spent: null }])[1]).toMatchObject({
      label: "All projects",
      day: null,
      month: null,
    });
  });
});

describe("SpendUsed", () => {
  it.each([
    [1 * USD, 5 * USD, "$1.00 of $5.00(20%)", ""],
    [4 * USD, 5 * USD, "$4.00 of $5.00(80%)", "text-attention"],
    [6 * USD, 5 * USD, "$6.00 of $5.00(100%)", "text-destructive"],
  ])("GivenUsed %s Of %s_WhenShown_ThenAmountsShareAndTone", (used, cap, text, tone) => {
    render(<SpendUsed used={used} cap={cap} label="AI today" />);
    const el = screen.getByLabelText(/^AI today:/);
    expect(el.textContent?.replace(/\s+/g, " ").replace(" (", "(")).toBe(text);
    if (tone) expect(el.className).toContain(tone);
  });

  it("GivenUnknownSpend_WhenShown_ThenUnknownNotZero", () => {
    render(<SpendUsed used={null} cap={5 * USD} label="AI today" />);
    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });
});

describe("Paid spend panel", () => {
  it("GivenAProjectWithoutALedger_WhenDashboardsOpen_ThenItsRowAndAllProjectsShowUnknown", async () => {
    const h = renderApp("/p/ai/dashboards");
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await h.queryClient.invalidateQueries();
    const panel = await screen.findByRole("region", { name: "Paid spend" }, PAGE_LOAD);
    const row = await within(panel).findByRole("row", { name: /^AI/ }, PAGE_LOAD);
    expect(within(row).getAllByText("unknown")).toHaveLength(2);
    const all = within(panel).getByRole("row", { name: /^All projects/ });
    expect(within(all).getAllByText("unknown")).toHaveLength(2);
  });

  it("GivenNoProjects_WhenDashboardsOpen_ThenAnEmptyStateNotLoadingForever", async () => {
    renderApp("/all/dashboards");
    const panel = await screen.findByRole("region", { name: "Paid spend" }, PAGE_LOAD);
    expect(await within(panel).findByText("No projects yet.", {}, PAGE_LOAD)).toBeTruthy();
  });

  it("GivenOneProjectsReadFails_WhenDashboardsOpen_ThenTheOtherStillShowsAndTheFailedOneIsUnknown", async () => {
    const h = renderApp("/all/dashboards", {
      beforeFetch: async (request) => {
        if (new URL(request.url).pathname === "/api/projects/web/spend") {
          throw new Error("spend read failed");
        }
      },
    });
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await h.tracker.createProject({ name: "Website", key: "WEB" });
    await h.queryClient.invalidateQueries();
    const panel = await screen.findByRole("region", { name: "Paid spend" }, PAGE_LOAD);
    const web = await within(panel).findByRole("row", { name: /^WEB/ }, PAGE_LOAD);
    expect(within(web).getAllByText("unknown")).toHaveLength(2);
    expect(within(panel).getByRole("row", { name: /^AI/ })).toBeTruthy();
    expect(within(panel).getByText(/Couldn't read spend for one project/)).toBeTruthy();
  });
});
