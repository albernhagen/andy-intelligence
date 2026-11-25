import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBuiltFonts, externalFontProblems } from "./check-fonts";

describe("check-fonts (AI-367)", () => {
  it("GivenABundledFontFace_WhenChecked_ThenNoProblem", () => {
    const css = `@font-face{font-family:"Inter Variable";src:url(/assets/inter-latin.woff2) format("woff2")}`;
    expect(externalFontProblems("index.css", css)).toEqual([]);
  });

  it("GivenAGoogleFontsLink_WhenChecked_ThenItIsNamed", () => {
    const html = `<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">`;
    expect(externalFontProblems("index.html", html)).toEqual([
      "index.html: names font host fonts.googleapis.com",
    ]);
  });

  it("GivenAFontFaceFromAnotherHost_WhenChecked_ThenRefused", () => {
    const css = `@font-face{font-family:X;src:url("https://cdn.example.com/x.woff2")}`;
    expect(externalFontProblems("a.css", css)).toEqual([
      "a.css: @font-face loads from another host",
    ]);
  });

  it("GivenAProtocolRelativeImport_WhenChecked_ThenRefused", () => {
    expect(externalFontProblems("a.css", `@import url(//example.com/fonts.css);`)).toEqual([
      "a.css: @import from another host",
    ]);
  });

  it("GivenABuiltDirectory_WhenOneFileLoadsAFontFromAHost_ThenOnlyThatFileIsReported", () => {
    const dist = mkdtempSync(join(tmpdir(), "fonts-"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), "<html></html>");
    writeFileSync(join(dist, "assets", "ok.css"), "@font-face{src:url(./a.woff2)}");
    writeFileSync(join(dist, "assets", "bad.js"), 'const u="https://fonts.gstatic.com/x.woff2"');
    expect(checkBuiltFonts(dist)).toEqual([
      `${join(dist, "assets", "bad.js")}: names font host fonts.gstatic.com`,
    ]);
  });
});
