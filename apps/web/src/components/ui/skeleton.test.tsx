import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "@/components/ui/skeleton";
import { expectTokenMotion, expectTokensOnly } from "@/test/tokens";

describe("Skeleton", () => {
  it("GivenASkeleton_WhenRendered_ThenItIsHiddenFromScreenReadersAndTakesTheGivenShape", () => {
    const { container } = render(<Skeleton className="h-8 w-40" />);

    const el = container.firstElementChild!;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("h-8");
    expect(el.className).toContain("bg-muted");
  });

  it("GivenASkeleton_WhenRendered_ThenItDoesNotPulseAndUsesTokensOnly", () => {
    const { container } = render(<Skeleton className="h-4" />);

    expect(container.innerHTML).not.toContain("animate-pulse");
    expectTokenMotion(container.innerHTML);
    expectTokensOnly(container.innerHTML);
  });
});
