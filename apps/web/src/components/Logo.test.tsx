import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Brand, LogoMark } from "@/components/Logo";
import { LOGO_PEAK, LOGO_WAVE } from "@/lib/logo";

/** AI-392: the mark takes its colours from the theme tokens, never a raw colour. */

describe("LogoMark", () => {
  it("GivenTheMark_WhenRendered_ThenThePeakUsesTheTextColourAndTheWaveThePrimaryToken", () => {
    const { container } = render(<LogoMark />);

    const [peak, wave] = [...container.querySelectorAll("path")] as [
      SVGPathElement,
      SVGPathElement,
    ];
    expect(peak.getAttribute("d")).toBe(LOGO_PEAK.d);
    expect(peak.getAttribute("stroke")).toBe("currentColor");
    expect(wave.getAttribute("d")).toBe(LOGO_WAVE.d);
    expect(wave.getAttribute("class")).toBe("stroke-primary");
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|oklch\(/i);
  });

  it("GivenNoLabel_WhenRendered_ThenTheMarkIsHiddenFromAssistiveTech", () => {
    const { container } = render(<LogoMark />);

    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("GivenALabel_WhenRendered_ThenTheMarkIsAnImageWithThatName", () => {
    render(<LogoMark label="andy-intelligence" />);

    expect(screen.getByRole("img", { name: "andy-intelligence" })).toBeTruthy();
  });
});

describe("Brand", () => {
  it("GivenTheBrand_WhenRendered_ThenTheMarkSitsBeforeTheProductName", () => {
    const { container } = render(<Brand />);

    const row = container.firstElementChild!;
    expect(row.firstElementChild!.tagName.toLowerCase()).toBe("svg");
    expect(row.textContent).toBe("andy-intelligence");
  });
});
