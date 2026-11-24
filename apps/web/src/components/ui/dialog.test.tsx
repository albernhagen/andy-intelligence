import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { expectTokenMotion, expectTokensOnly } from "@/test/tokens";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "../../index.css"), "utf8");

function Example() {
  return (
    <Dialog>
      <DialogTrigger>Cancel ticket</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel AI-3?</DialogTitle>
          <DialogDescription>Its open PR closes too.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button">Keep it</button>
          <button type="button">Cancel ticket</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("GivenTheTrigger_WhenPressedWithTheKeyboard_ThenTheDialogOpensWithFocusInside", async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.tab();
    await user.keyboard("{Enter}");

    const dialog = screen.getByRole("dialog", { name: "Cancel AI-3?" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByText("Its open PR closes too.")).toBeTruthy();
  });

  it("GivenAnOpenDialog_WhenTabbingPastTheLastControl_ThenFocusWrapsInsideIt", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Cancel ticket" }));
    const dialog = screen.getByRole("dialog");

    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("GivenAnOpenDialog_WhenEscIsPressed_ThenItClosesAndFocusReturnsToTheTrigger", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Cancel ticket" });
    await user.click(trigger);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("GivenAnOpenDialog_WhenRendered_ThenTheCloseButtonIsATouchTargetWithAFocusRingAndTokensOnly", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Cancel ticket" }));

    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("size-11");
    expect(close.className).toContain("focus-visible:outline-ring");
    const html = document.body.innerHTML;
    expect(screen.getByRole("dialog").className).toContain("animate-enter");
    expectTokenMotion(html);
    expectTokensOnly(html);
  });

  // AI-369: every feedback component moves with `animate-enter`; this is what keeps it ≤ 180 ms
  // and off under prefers-reduced-motion.
  it("GivenTheEnterMotion_WhenReducedMotionIsAsked_ThenItLasts150msAndIsTurnedOff", () => {
    expect(css).toMatch(/--animate-enter:\s*enter 150ms var\(--ease-standard\)/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/animation-duration:\s*0s !important/);
    expect(reduced).toMatch(/transition-duration:\s*0s !important/);
  });
});
