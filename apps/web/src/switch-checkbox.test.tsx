import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

/** AI-368: Switch and Checkbox on Radix; with a label the row is the 44 px target on a phone. */

const noLiteralColours = /#[0-9a-f]{3,6}|rgb\(|oklch\(|dark:/i;

describe("Switch", () => {
  it("GivenAFocusedSwitch_WhenSpaceIsPressed_ThenItTurnsOn", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch label="Auto-refine" onCheckedChange={onCheckedChange} />);

    await user.tab();
    const sw = screen.getByRole("switch", { name: "Auto-refine" });
    expect(document.activeElement).toBe(sw);
    await user.keyboard(" ");

    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("GivenALabelledSwitch_WhenTheLabelIsClicked_ThenItToggles", async () => {
    const user = userEvent.setup();
    render(<Switch label="Auto-refine" description="Starts on its own." defaultChecked />);

    await user.click(screen.getByText("Starts on its own."));

    expect(screen.getByRole("switch", { name: /Auto-refine/ }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("GivenALabelledSwitch_WhenRendered_ThenTheRowIsAPhoneTargetWithAFocusRing", () => {
    render(<Switch label="Auto-refine" />);
    const sw = screen.getByRole("switch", { name: "Auto-refine" });

    expect(sw.closest("label")?.className).toContain("max-sm:min-h-11");
    expect(sw.className).toContain("focus-visible:outline-ring");
    expect(sw.className).toContain("data-[state=checked]:bg-primary");
    expect(sw.className).not.toMatch(noLiteralColours);
  });
});

describe("Checkbox", () => {
  it("GivenAFocusedCheckbox_WhenSpaceIsPressed_ThenItIsChecked", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Dev" onCheckedChange={onCheckedChange} />);

    await user.tab();
    const box = screen.getByRole("checkbox", { name: "Dev" });
    expect(document.activeElement).toBe(box);
    await user.keyboard(" ");

    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(box.getAttribute("aria-checked")).toBe("true");
  });

  it("GivenAnIndeterminateCheckbox_WhenRendered_ThenItIsMixed", () => {
    render(<Checkbox label="All environments" checked="indeterminate" />);

    expect(
      screen.getByRole("checkbox", { name: "All environments" }).getAttribute("aria-checked"),
    ).toBe("mixed");
  });

  it("GivenALabelledCheckbox_WhenRendered_ThenTheRowIsAPhoneTargetWithAFocusRing", () => {
    render(<Checkbox label="Dev" disabled />);
    const box = screen.getByRole("checkbox", { name: "Dev" });

    expect(box.closest("label")?.className).toContain("max-sm:min-h-11");
    expect(box.className).toContain("focus-visible:outline-ring");
    expect(box.hasAttribute("disabled")).toBe(true);
    expect(box.className).not.toMatch(noLiteralColours);
  });
});
