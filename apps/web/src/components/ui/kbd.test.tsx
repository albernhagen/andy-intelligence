import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Kbd } from "@/components/ui/kbd";
import { expectTokensOnly } from "@/test/tokens";

describe("Kbd", () => {
  it("GivenAKeyHintOnAButton_WhenRendered_ThenTheButtonKeepsItsVerbAndAnnouncesTheKey", () => {
    render(
      <button type="button" aria-keyshortcuts="Z">
        Undo <Kbd>Z</Kbd>
      </button>,
    );

    const button = screen.getByRole("button", { name: "Undo" });
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Z");
    const key = button.querySelector("kbd")!;
    expect(key.textContent).toBe("Z");
    expect(key.getAttribute("aria-hidden")).toBe("true");
    expect(key.className).toContain("font-mono");
  });

  it("GivenAKbd_WhenRendered_ThenItUsesTokensOnly", () => {
    const { container } = render(<Kbd>?</Kbd>);
    expectTokensOnly(container.innerHTML);
  });
});
