import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { expectTokenMotion, expectTokensOnly } from "@/test/tokens";

function Example({ side }: { side?: "right" | "bottom" }) {
  return (
    <Sheet>
      <SheetTrigger>Filters</SheetTrigger>
      <SheetContent side={side}>
        <SheetTitle>Filters</SheetTitle>
        <SheetDescription>Narrow the board.</SheetDescription>
        <input aria-label="Search" />
      </SheetContent>
    </Sheet>
  );
}

describe("Sheet", () => {
  it("GivenAnOpenSheet_WhenTabbing_ThenFocusStaysInsideIt", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });

    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
    }
  });

  it("GivenAnOpenSheet_WhenEscIsPressed_ThenItClosesAndFocusReturnsToTheTrigger", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Filters" });
    await user.click(trigger);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it.each([
    ["right", "sm:right-0"],
    ["bottom", "sm:bottom-0"],
  ] as const)(
    "GivenSide%s_WhenOpened_ThenItSitsOnThatEdgeFillsAPhoneAndUsesTokensOnly",
    async (side, edge) => {
      const user = userEvent.setup();
      render(<Example side={side} />);
      await user.click(screen.getByRole("button", { name: "Filters" }));

      const sheet = screen.getByRole("dialog");
      expect(sheet.className).toContain(edge);
      expect(sheet.className).toContain("max-sm:inset-0");
      expectTokenMotion(document.body.innerHTML);
      expectTokensOnly(document.body.innerHTML);
    },
  );
});
