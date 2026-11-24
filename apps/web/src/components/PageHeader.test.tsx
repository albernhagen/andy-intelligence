import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PageHeader } from "@/components/PageHeader";

/** AI-378: the bar atop a page: title, view controls, actions at the end. */

describe("PageHeader", () => {
  it("GivenATitleControlsAndActions_WhenRendered_ThenTheTitleIsALevelTwoHeadingAndActionsSitLast", () => {
    render(
      <PageHeader title="Roadmap" actions={<button type="button">Plan this project</button>}>
        <button type="button">Open</button>
      </PageHeader>,
    );

    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("heading", { level: 2, name: "Roadmap" })).toBeTruthy();
    const buttons = within(bar)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(buttons).toEqual(["Open", "Plan this project"]);
    expect(within(bar).getByText("Plan this project").parentElement!.className).toContain(
      "ml-auto",
    );
  });

  it("GivenOnlyATitle_WhenRendered_ThenNoEmptyActionsBoxAndABorderBelow", () => {
    render(<PageHeader title="Work" />);

    const bar = screen.getByRole("banner");
    expect(bar.children).toHaveLength(1);
    expect(bar.className).toContain("border-b");
    expect(bar.className).not.toMatch(/#[0-9a-f]{3,8}|dark:/);
  });
});
