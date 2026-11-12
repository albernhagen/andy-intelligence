import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer,
  ChartLegendContent,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/** M4.9: Chart component: the shadcn wrapper over recharts, coloured from the design tokens. */

const config = {
  merged: { label: "Merged", color: "var(--success)" },
  failed: { label: "Failed", color: "var(--destructive)" },
} satisfies ChartConfig;

// jsdom has no layout or ResizeObserver, so the container keeps this size.
const size = { width: 400, height: 200 };

const data = [
  { week: "W1", merged: 3, failed: 1 },
  { week: "W2", merged: 5, failed: 0 },
];

function renderChart() {
  return render(
    <ChartContainer id="test" config={config} initialDimension={size}>
      <BarChart data={data} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="week" />
        <Bar dataKey="merged" fill="var(--color-merged)" isAnimationActive={false} />
        <Bar dataKey="failed" fill="var(--color-failed)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>,
  );
}

describe("chart component", () => {
  it("GivenAConfigWithTokenColours_WhenAChartRenders_ThenItMountsWithThoseColours", () => {
    const { container } = renderChart();

    const style = container.querySelector("style")?.textContent ?? "";
    expect(style).toContain("[data-chart=chart-test]");
    expect(style).toContain("--color-merged: var(--success);");
    expect(style).toContain("--color-failed: var(--destructive);");

    expect(container.querySelector(".recharts-surface")).not.toBeNull();
    const fills = [...container.querySelectorAll(".recharts-bar-rectangle path")].map((p) =>
      p.getAttribute("fill"),
    );
    expect(fills).toContain("var(--color-merged)");
    expect(fills).toContain("var(--color-failed)");
  });

  it("GivenAChartWithAHoveredPoint_WhenTheTooltipRenders_ThenItShowsConfigLabelsAndValues", () => {
    const { getByText } = render(
      <ChartContainer config={config} initialDimension={size}>
        <ChartTooltipContent
          active
          label="W1"
          payload={[
            {
              dataKey: "merged",
              name: "merged",
              value: 3,
              color: "var(--color-merged)",
              graphicalItemId: "merged",
            },
            {
              dataKey: "failed",
              name: "failed",
              value: 1,
              color: "var(--color-failed)",
              graphicalItemId: "failed",
            },
          ]}
        />
      </ChartContainer>,
    );
    expect(getByText("Merged")).toBeTruthy();
    expect(getByText("Failed")).toBeTruthy();
    expect(getByText("3")).toBeTruthy();
  });

  it("GivenLegendItems_WhenTheLegendRenders_ThenEachSeriesShowsItsLabel", () => {
    const { getByText } = render(
      <ChartContainer config={config} initialDimension={size}>
        <ChartLegendContent
          payload={[
            { value: "merged", dataKey: "merged", color: "var(--color-merged)" },
            { value: "failed", dataKey: "failed", color: "var(--color-failed)" },
          ]}
        />
      </ChartContainer>,
    );
    expect(getByText("Merged")).toBeTruthy();
    expect(getByText("Failed")).toBeTruthy();
  });
});
