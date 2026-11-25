import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DashboardWeek } from "@andy/contracts";
import { StatTiles } from "@/pages/DashboardsPage";

/** AI-378: the dashboard's four headline numbers; lead time names the one week it shows. */

const week = (start: string, over: Partial<DashboardWeek> = {}): DashboardWeek =>
  ({
    start,
    end: start,
    ticketsByStage: {},
    leadTimeHours: { median: null, p90: null, count: 0 },
    reworks: 0,
    ciGreenFirstTry: { green: 0, known: 0, rate: null },
    reviewBlockers: 0,
    cost: { runs: 0, unknownCostRuns: 0, estimatedCostUsd: 0 },
    byStep: [],
    bySize: [],
    ...over,
  }) as unknown as DashboardWeek;

const tile = (title: string) => screen.getByText(title).closest("li") as HTMLElement;

describe("StatTiles", () => {
  it("GivenTwelveWeeksWithDoneTicketsInTwo_WhenShown_ThenLeadTimeIsTheLatestSuchWeekAndSaysWhich", () => {
    const weeks = [
      week("2026-09-07T00:00:00Z", { leadTimeHours: { median: 48, p90: 60, count: 5 } }),
      ...Array.from({ length: 9 }, (_, i) => week(`2026-09-${14 + i}T00:00:00Z`)),
      week("2026-11-16T00:00:00Z", { leadTimeHours: { median: 3, p90: 4, count: 1 } }),
      week("2026-11-23T00:00:00Z"),
    ];
    render(<StatTiles weeks={weeks} span={12} />);

    const lead = tile("Lead time, latest week");
    expect(within(lead).getByText("3 hours")).toBeTruthy();
    expect(within(lead).getByText("median, Ready to Done, week of Nov 16")).toBeTruthy();
  });

  it("GivenTheWindowsSums_WhenShown_ThenCiReworkAndCostCoverEveryWeek", () => {
    const weeks = [
      week("2026-11-09T00:00:00Z", {
        reworks: 1,
        reviewBlockers: 2,
        ciGreenFirstTry: { green: 1, known: 2, rate: 0.5 },
        cost: { runs: 2, unknownCostRuns: 1, estimatedCostUsd: 1.25 } as DashboardWeek["cost"],
      }),
      week("2026-11-16T00:00:00Z", {
        reworks: 3,
        ciGreenFirstTry: { green: 2, known: 2, rate: 1 },
        cost: { runs: 1, unknownCostRuns: 0, estimatedCostUsd: 2 } as DashboardWeek["cost"],
      }),
    ];
    render(<StatTiles weeks={weeks} span={2} />);

    expect(within(tile("CI green on first try")).getByText("75%")).toBeTruthy();
    expect(within(tile("Rework and review blockers")).getByText("6")).toBeTruthy();
    expect(within(tile("Cost, estimate")).getByText("$3.25")).toBeTruthy();
    expect(
      within(tile("Cost, estimate")).getByText("3 agent tasks · 1 with unknown cost"),
    ).toBeTruthy();
  });

  it("GivenNothingMeasured_WhenShown_ThenDashesWithTheReason", () => {
    render(<StatTiles weeks={[week("2026-11-23T00:00:00Z")]} span={4} />);

    expect(
      within(tile("Lead time, latest week")).getByText("No ticket reached Done yet"),
    ).toBeTruthy();
    expect(within(tile("CI green on first try")).getByText("No closed agent PRs yet")).toBeTruthy();
    expect(within(tile("Rework and review blockers")).getByText("in these 4 weeks")).toBeTruthy();
  });
});
