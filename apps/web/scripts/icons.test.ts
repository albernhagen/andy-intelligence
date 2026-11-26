// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { faviconSvg, iconColours, oklchToHex } from "./icons";

/** AI-392: the static favicon is built from the mark and the colour tokens. */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("icons", () => {
  it("GivenOklchColours_WhenConverted_ThenTheyMatchSrgb", () => {
    expect(oklchToHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
    expect(oklchToHex("oklch(0.628 0.2577 29.23)")).toBe("#ff0000");
  });

  it("GivenTheTokens_WhenTheFaviconIsBuilt_ThenTheCommittedFileMatches", () => {
    const expected = faviconSvg(iconColours(read("../src/index.css")));

    // A drift here means `pnpm --filter @andy/web icons` wasn't rerun after a token or mark change.
    expect(read("../public/favicon.svg")).toBe(expected);
  });

  it("GivenTheIndexPage_WhenRead_ThenItLinksTheSvgFaviconAndItsPngFallback", () => {
    const html = read("../index.html");

    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(html).toContain('href="/icons/favicon-32.png"');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
  });
});
