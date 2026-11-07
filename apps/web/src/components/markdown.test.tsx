import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown, safeUrl } from "./Markdown";

/**
 * Untrusted markdown (ADR-0059: UX foundation, row "Markdown"): agent-written text must never
 * run script, inject HTML, load a remote resource or link to a non-http(s)/mailto URL.
 */

function renderMd(source: string) {
  const { container } = render(<Markdown>{source}</Markdown>);
  // The Markdown wrapper; everything inside it comes from the source.
  return container.firstElementChild!;
}

describe("Markdown", () => {
  it("GivenMarkdown_WhenRendered_ThenItIsFormatted", () => {
    const c = renderMd("# Goal\n\nSome **bold** and `code`.\n\n- one\n- two");
    expect(screen.getByRole("heading", { name: "Goal" })).toBeTruthy();
    expect(c.querySelector("strong")?.textContent).toBe("bold");
    expect(c.querySelector("code")?.textContent).toBe("code");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("GivenALink_WhenRendered_ThenItOpensInANewTabWithoutReferrerAndShowsItsHost", () => {
    renderMd("See [the docs](https://example.com/a/b).");
    const link = screen.getByRole("link", { name: "the docs" });
    expect(link.getAttribute("href")).toBe("https://example.com/a/b");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(screen.getByText("(example.com)")).toBeTruthy();
  });

  it("GivenAMailtoLink_WhenRendered_ThenItIsALink", () => {
    renderMd("[mail](mailto:andy@example.com)");
    expect(screen.getByRole("link", { name: "mail" }).getAttribute("href")).toBe(
      "mailto:andy@example.com",
    );
  });

  it("GivenAScriptTag_WhenRendered_ThenNoScriptElementIsCreated", () => {
    const c = renderMd("Hi <script>window.pwned = 1</script>\n\n<script>window.pwned = 2</script>");
    expect(c.querySelector("script")).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it("GivenAnInlineEventHandler_WhenRendered_ThenNoElementCarriesIt", () => {
    const c = renderMd(
      '<img src=x onerror="window.pwned=1">\n\n<div onclick="window.pwned=1">x</div>',
    );
    expect(c.querySelector("[onerror], [onclick], img, div")).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it("GivenRawHtml_WhenRendered_ThenItShowsAsTextNotElements", () => {
    const c = renderMd(
      '<b>bold</b> <a href="https://evil.example">x</a> <iframe src="https://evil.example"></iframe>',
    );
    expect(c.querySelector("b, iframe, a")).toBeNull();
    expect(c.textContent).toContain("<b>bold</b>");
  });

  it("GivenAJavascriptLink_WhenRendered_ThenItIsPlainText", () => {
    const c = renderMd(
      "[click](javascript:alert(1)) [two](JaVaScRiPt:alert(1)) [three]( javascript:alert(1)) [data](data:text/html,<b>x</b>)",
    );
    expect(c.querySelector("a")).toBeNull();
    expect(screen.getByText("click")).toBeTruthy();
  });

  it("GivenARemoteImage_WhenRendered_ThenNothingIsLoadedAndItsAltTextLinksToIt", () => {
    const c = renderMd("![tracking pixel](https://evil.example/p.gif)");
    expect(c.querySelector("img, picture, source, video, audio")).toBeNull();
    const link = screen.getByRole("link", { name: "tracking pixel" });
    expect(link.getAttribute("href")).toBe("https://evil.example/p.gif");
    expect(screen.getByText("(evil.example)")).toBeTruthy();
  });

  it("GivenAnImageWithABadUrl_WhenRendered_ThenOnlyItsAltTextShows", () => {
    const c = renderMd("![x](javascript:alert(1))");
    expect(c.querySelector("img, a")).toBeNull();
    expect(c.textContent).toBe("x");
  });
});

describe("safeUrl", () => {
  it("GivenUrls_WhenChecked_ThenOnlyHttpHttpsAndMailtoPass", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com");
    expect(safeUrl("http://example.com")).toBe("http://example.com");
    expect(safeUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    for (const bad of [
      "javascript:alert(1)",
      " JAVASCRIPT:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "file:///etc/passwd",
      "/relative",
      "//evil.example/x",
      "",
    ])
      expect(safeUrl(bad)).toBe("");
  });
});
