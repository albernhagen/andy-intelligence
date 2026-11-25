import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { expectTokenMotion, expectTokensOnly } from "@/test/tokens";

function Example() {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger>Quota</TooltipTrigger>
      <TooltipContent>5-hour window: 42% used</TooltipContent>
    </Tooltip>
  );
}

describe("Tooltip", () => {
  it("GivenATrigger_WhenFocusedByKeyboard_ThenTheTooltipShowsAndDescribesIt", async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.tab();

    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain("5-hour window: 42% used");
    const trigger = screen.getByRole("button", { name: "Quota" });
    expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);
  });

  it("GivenAnOpenTooltip_WhenEscIsPressed_ThenItCloses", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.tab();
    await screen.findByRole("tooltip");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("GivenAnOpenTooltip_WhenRendered_ThenItUsesTheEnterMotionAndTokensOnly", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.tab();
    await screen.findByRole("tooltip");

    expect(document.body.innerHTML).toContain("animate-enter");
    expectTokenMotion(document.body.innerHTML);
    expectTokensOnly(document.body.innerHTML);
  });
});
