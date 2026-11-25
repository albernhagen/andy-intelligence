import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { OptionCards, OptionTable } from "@/components/ui/option-cards";

/** AI-368: a picker with fewer than six options shows every option with its description. */

const plan = [
  { value: "never", label: "Never", description: "Builds start without a plan." },
  { value: "medium", label: "Medium and large", description: "Bigger tickets wait for you." },
  { value: "every", label: "Every ticket", description: "Every ticket waits for you." },
] as const;

type Plan = (typeof plan)[number]["value"];

function Cards({ onChange = () => {} }: { onChange?: (v: Plan) => void }) {
  const [value, setValue] = useState<Plan>("never");
  return (
    <OptionCards
      label="Plan approval"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange(v);
      }}
      options={plan}
    />
  );
}

describe("OptionCards", () => {
  it("GivenThreeOptions_WhenRendered_ThenEveryOptionShowsItsLabelAndDescription", () => {
    render(<Cards />);

    const group = screen.getByRole("radiogroup", { name: "Plan approval" });
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    for (const o of plan) expect(group.textContent).toContain(o.description);
    expect(screen.getByRole("radio", { name: /Never/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("GivenFocusOnThePickedOption_WhenArrowDownIsPressed_ThenTheNextOptionIsPicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Cards onChange={onChange} />);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Never/ }));
    // Held, as in a browser: Radix moves focus on the next tick and picks the radio it lands on
    // only while the arrow key is down.
    await user.keyboard("{ArrowDown>}");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("medium"));
    await user.keyboard("{/ArrowDown}");
    expect(screen.getByRole("radio", { name: /Medium/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("GivenAnOption_WhenRendered_ThenItHasAFocusRingAPhoneTargetAndTheSelectedState", () => {
    render(<Cards />);
    const cls = screen.getByRole("radio", { name: /Never/ }).className;

    expect(cls).toContain("focus-visible:outline-ring");
    expect(cls).toContain("min-h-11");
    expect(cls).toContain("data-[state=checked]:bg-selected");
    expect(cls).not.toContain("bg-primary");
    expect(cls).not.toMatch(/#[0-9a-f]{3,6}|rgb\(|oklch\(|dark:/i);
  });
});

describe("OptionTable", () => {
  const modes = [
    { value: "manual", label: "Manual", facts: ["Nothing", "Every PR"] },
    { value: "low-risk", label: "Low risk", facts: ["Clean PRs", "High-risk PRs"] },
  ] as const;

  it("GivenOptionsWithTwoFacts_WhenRendered_ThenEachRowNamesBothFacts", () => {
    render(
      <OptionTable
        label="Merge mode"
        value="low-risk"
        onValueChange={() => {}}
        columns={["Merges on its own", "Waits for you"]}
        options={modes}
      />,
    );

    const row = screen.getByRole("radio", { name: /Low risk/ });
    expect(row.getAttribute("aria-checked")).toBe("true");
    expect(row.textContent).toContain("Merges on its own: Clean PRs");
    expect(row.textContent).toContain("Waits for you: High-risk PRs");
    expect(row.className).toContain("min-h-11");
  });

  it("GivenFocusInTheTable_WhenArrowUpIsPressed_ThenThePreviousRowIsPicked", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <OptionTable
        label="Merge mode"
        value="low-risk"
        onValueChange={onValueChange}
        columns={["Merges on its own", "Waits for you"]}
        options={modes}
      />,
    );

    await user.tab();
    await user.keyboard("{ArrowUp>}");
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("manual"));
    await user.keyboard("{/ArrowUp}");
  });
});
