import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryError } from "@/components/Status";
import { ApiError } from "@/lib/api";

/** AI-332: a failed read says what the API said, else names what couldn't be read. */
describe("QueryError", () => {
  it("GivenTheApisMessage_WhenShown_ThenItIsTheText", () => {
    render(<QueryError error={new ApiError(409, "Changed since you opened it", ["title"])} />);

    expect(screen.getByRole("alert").textContent).toBe("Changed since you opened it: title");
  });

  it("GivenNoMessageFromTheApi_WhenShown_ThenItNamesWhatAndTheStatusWithARetry", () => {
    const onRetry = vi.fn();
    render(
      <QueryError
        error={new ApiError(404, "request failed (404)", [], false)}
        what="the GitHub connection"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Couldn't read the GitHub connection (404).")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("GivenNoMessageAndNoName_WhenShown_ThenItStillGivesTheStatus", () => {
    render(<QueryError error={new ApiError(502, "request failed (502)", [], false)} />);

    expect(screen.getByRole("alert").textContent).toBe(
      "The request failed (502) without saying why.",
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
