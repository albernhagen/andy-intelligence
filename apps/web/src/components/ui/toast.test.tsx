import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_TOASTS, TOAST_DURATION_MS, Toaster, resetToasts, toast } from "@/components/ui/toast";
import { expectTokenMotion, expectTokensOnly } from "@/test/tokens";

afterEach(() => {
  act(() => resetToasts());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Toast", () => {
  it("GivenAWriteThatCanBeReversed_WhenTheCallerShowsAToast_ThenItConfirmsWithUndo", () => {
    render(<Toaster />);

    act(() => void toast({ title: "Answered AI-3", undo: () => {} }));

    expect(screen.getByText("Answered AI-3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("GivenAWriteThatCannotBeReversed_WhenShown_ThenNoUndo", () => {
    render(<Toaster />);

    act(() => void toast({ title: "Merged PR #74", description: "into main" }));

    expect(screen.getByText("into main")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("GivenAToastWithUndo_WhenUndoIsPressedByKeyboard_ThenTheWriteIsReversedAndTheToastCloses", async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    render(<Toaster />);
    act(() => void toast({ title: "Answered AI-3", undo }));

    screen.getByRole("button", { name: "Undo" }).focus();
    await user.keyboard("{Enter}");

    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Answered AI-3")).toBeNull();
  });

  it("GivenAnUndoThatFails_WhenPressed_ThenTheErrorShowsAsAToastAndIsLogged", async () => {
    const user = userEvent.setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Toaster />);
    act(
      () =>
        void toast({
          title: "Answered AI-3",
          undo: () => Promise.reject(new Error("Ticket moved on (409)")),
        }),
    );

    // Keyboard, not a click: jsdom has no pointer capture for Radix's swipe handler.
    screen.getByRole("button", { name: "Undo" }).focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Couldn't undo")).toBeTruthy();
    expect(screen.getByText("Ticket moved on (409)")).toBeTruthy();
    expect(logged).toHaveBeenCalled();
  });

  it("GivenAFocusedToast_WhenEscIsPressed_ThenItCloses", async () => {
    const user = userEvent.setup();
    render(<Toaster />);
    act(() => void toast({ title: "Saved worker", undo: () => {} }));

    screen.getByRole("button", { name: "Undo" }).focus();
    await user.keyboard("{Escape}");

    expect(screen.queryByText("Saved worker")).toBeNull();
  });

  it("GivenAToast_WhenItsDurationPasses_ThenItCloses", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => void toast({ title: "Saved worker" }));

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS + 50));

    expect(screen.queryByText("Saved worker")).toBeNull();
  });

  it("GivenMoreToastsThanTheCap_WhenShown_ThenOnlyTheNewestStay", () => {
    render(<Toaster />);

    act(() => {
      for (let i = 1; i <= MAX_TOASTS + 1; i++) toast({ title: `Write ${i}` });
    });

    expect(screen.queryByText("Write 1")).toBeNull();
    expect(screen.getByText(`Write ${MAX_TOASTS + 1}`)).toBeTruthy();
  });

  it("GivenAToast_WhenRendered_ThenControlsAreTouchTargetsWithFocusRingsAndTokensOnly", () => {
    render(<Toaster />);
    act(() => void toast({ title: "Answered AI-3", undo: () => {}, tone: "default" }));
    act(() => void toast({ title: "Couldn't save", tone: "destructive" }));

    for (const name of ["Undo", "Dismiss"]) {
      const button = screen.getAllByRole("button", { name })[0]!;
      expect(button.className).toMatch(/\b(h|size)-11\b/);
      expect(button.className).toContain("focus-visible:outline-ring");
    }
    expect(document.body.innerHTML).toContain("animate-enter");
    expectTokenMotion(document.body.innerHTML);
    expectTokensOnly(document.body.innerHTML);
  });
});
