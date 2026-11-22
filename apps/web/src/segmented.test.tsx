import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Segmented } from "@/components/ui/segmented";

/** AI-333: one shared toggle; the picked option is quiet (`bg-muted`), never the primary fill. */

const options = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
] as const;

describe("Segmented", () => {
  it("GivenAPickedValue_WhenRendered_ThenOnlyItIsPressedAndNoneUsesThePrimaryFill", () => {
    render(<Segmented label="Window" value={30} options={options} onChange={() => {}} />);

    const group = screen.getByRole("group", { name: "Window" });
    const picked = screen.getByRole("button", { name: "30 days" });
    expect(picked.getAttribute("aria-pressed")).toBe("true");
    expect(picked.className).toContain("bg-muted");
    expect(screen.getByRole("button", { name: "7 days" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(group.innerHTML).not.toContain("bg-primary");
    // An unpicked option's hover is lighter than the picked option's bg-muted.
    const other = screen.getByRole("button", { name: "7 days" });
    expect(other.className).not.toMatch(/(^|\s)(hover:)?bg-muted(\s|$)/);
    expect(other.className).toContain("hover:bg-foreground/5");
  });

  it("GivenAnOption_WhenClicked_ThenItsValueIsPassedOn", () => {
    const onChange = vi.fn();
    render(<Segmented label="Window" value={30} options={options} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "7 days" }));

    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("GivenANullValue_WhenItIsPicked_ThenItIsPressed", () => {
    render(
      <Segmented
        label="Work view"
        value={null}
        options={[
          { value: null, label: "All" },
          { value: "mine", label: "Mine" },
        ]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  });
});
