import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** AI-368: Select on Radix for six or more options; keyboard alone, focus ring, 44 px on a phone. */

beforeAll(() => {
  // jsdom lacks the pointer-capture and scroll APIs Radix Select calls.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

function Picker({ onValueChange = () => {} }: { onValueChange?: (v: string) => void }) {
  return (
    <Select defaultValue="a" onValueChange={onValueChange}>
      <SelectTrigger aria-label="Region">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Alpha</SelectItem>
        <SelectItem value="b" description="Second choice">
          Beta
        </SelectItem>
        <SelectItem value="c">Gamma</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe("Select", () => {
  it("GivenAFocusedTrigger_WhenArrowAndEnterArePressed_ThenTheNextOptionIsPicked", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Picker onValueChange={onValueChange} />);

    await user.tab();
    const trigger = screen.getByRole("combobox", { name: "Region" });
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("listbox")).toBeTruthy();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onValueChange).toHaveBeenCalledWith("b");
    expect(trigger.textContent).toContain("Beta");
  });

  it("GivenAnOpenList_WhenEscapeIsPressed_ThenItClosesAndFocusReturnsToTheTrigger", async () => {
    const user = userEvent.setup();
    render(<Picker />);

    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Region" }));
  });

  it("GivenAnOptionWithADescription_WhenOpened_ThenTheDescriptionShows", async () => {
    const user = userEvent.setup();
    render(<Picker />);

    await user.click(screen.getByRole("combobox", { name: "Region" }));

    expect((await screen.findByRole("option", { name: /Beta/ })).textContent).toContain(
      "Second choice",
    );
  });

  it("GivenTheTrigger_WhenRendered_ThenItHasAFocusRingAPhoneTargetAndTokenColoursOnly", () => {
    render(<Picker />);
    const cls = screen.getByRole("combobox", { name: "Region" }).className;

    expect(cls).toContain("focus-visible:outline-ring");
    expect(cls).toContain("h-11");
    expect(cls).toContain("sm:h-8");
    expect(cls).not.toMatch(/#[0-9a-f]{3,6}|rgb\(|oklch\(|dark:/i);
  });
});
