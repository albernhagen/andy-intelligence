import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { expectTokensOnly } from "@/test/tokens";

describe("EmptyState", () => {
  it("GivenWhatIsMissingAndOneNextStep_WhenRendered_ThenBothShowAndTheStepIsReachableByKeyboard", async () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon={Inbox}
        title="Nothing needs you."
        description="New questions land here."
        action={
          <button type="button" onClick={onClick}>
            Open the board
          </button>
        }
      />,
    );

    expect(screen.getByText("Nothing needs you.")).toBeTruthy();
    expect(screen.getByText("New questions land here.")).toBeTruthy();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open the board" }));
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("GivenOnlyATitle_WhenRendered_ThenNoEmptyDescriptionOrActionAndTokensOnly", () => {
    const { container } = render(<EmptyState title="No agent tasks yet." />);

    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
    expectTokensOnly(container.innerHTML);
  });
});
