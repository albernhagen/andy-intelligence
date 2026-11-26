import { LOGO_LIMITS } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { checkLogo, checkPng, sanitizeSvg } from "./logo-sanitize";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (inner: string, attrs = "") => `<svg ${NS} viewBox="0 0 24 24"${attrs}>${inner}</svg>`;

const refused = (markup: string) => {
  const result = sanitizeSvg(markup);
  if (result.ok) throw new Error(`expected a refusal, got ${result.data}`);
  return result.reason;
};
const kept = (markup: string) => {
  const result = sanitizeSvg(markup);
  if (!result.ok) throw new Error(`expected it kept, got ${result.reason}`);
  return result.data;
};

describe("sanitizeSvg", () => {
  it("Given a plain drawing_When sanitized_Then it is kept with its shapes and the SVG namespace", () => {
    const out = kept(
      `<?xml version="1.0"?>` +
        svg(`<g fill="none"><path d="M3 22 L12 4.5" stroke="#0a0" stroke-width="3"/></g>`),
    );
    expect(out).toBe(
      `<svg ${NS} viewBox="0 0 24 24"><g fill="none"><path d="M3 22 L12 4.5" stroke="#0a0" stroke-width="3"/></g></svg>`,
    );
  });

  it("Given gradients and internal references_When sanitized_Then they are kept in SVG's camelCase", () => {
    const out = kept(
      svg(
        `<defs><linearGradient id="a" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="24" height="24" fill="url(#a)"/><use href="#a"/>`,
      ),
    );
    expect(out).toContain('<linearGradient id="a" gradientUnits="userSpaceOnUse">');
    expect(out).toContain('fill="url(#a)"');
    expect(out).toContain('<use href="#a"/>');
  });

  it("Given an xlink:href to an internal id_When sanitized_Then the xlink namespace is declared", () => {
    const out = kept(
      `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><defs><path id="p" d="M0 0"/></defs><use xlink:href="#p"/></svg>`,
    );
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(out).toContain('<use xlink:href="#p"/>');
  });

  it("Given editor metadata and unknown attributes_When sanitized_Then they are dropped", () => {
    const out = kept(
      `<svg ${NS} xmlns:sodipodi="x" sodipodi:docname="a.svg" inkscape:version="1"><metadata><rdf>x</rdf></metadata><sodipodi:namedview/><path d="M0 0" data-x="1"/></svg>`,
    );
    expect(out).toBe(`<svg ${NS}><path d="M0 0"/></svg>`);
  });

  it("Given text with markup characters_When sanitized_Then the text is escaped again", () => {
    expect(kept(svg(`<text x="1">a &amp; b &lt;c&gt;</text>`))).toContain(
      '<text x="1">a &amp; b &lt;c&gt;</text>',
    );
  });

  it("Given a comment_When sanitized_Then it is dropped", () => {
    expect(kept(svg(`<!-- <script>x</script> --><path d="M0 0"/>`))).toBe(
      `<svg ${NS} viewBox="0 0 24 24"><path d="M0 0"/></svg>`,
    );
  });

  it.each([
    ["a script", svg("<script>alert(1)</script>"), "<script>"],
    ["an uppercase script", svg("<SCRIPT>alert(1)</SCRIPT>"), "<SCRIPT>"],
    [
      "a namespaced script",
      `<svg ${NS} xmlns:s="${"http://www.w3.org/2000/svg"}"><s:script>x</s:script></svg>`,
      "<s:script>",
    ],
    ["foreignObject", svg("<foreignObject><div/></foreignObject>"), "<foreignObject>"],
    ["an image", svg('<image href="#a"/>'), "<image>"],
    ["a link", svg('<a href="#a"><path d="M0 0"/></a>'), "<a>"],
    ["an animation", svg('<set attributeName="fill" to="red"/>'), "<set>"],
    [
      "a script inside dropped metadata",
      svg("<metadata><script>x</script></metadata>"),
      "<script>",
    ],
  ])("Given %s_When sanitized_Then it is refused naming the element", (_, markup, element) => {
    expect(refused(markup)).toContain(element);
  });

  it.each([
    ["onload on the root", svg("", ' onload="alert(1)"'), "event handler"],
    ["onclick on a shape", svg('<path d="M0 0" onClick="x"/>'), "event handler"],
    ["an external href", svg('<use href="https://evil.example/a.svg#x"/>'), "external reference"],
    ["an external xlink:href", svg('<use xlink:href="//evil.example/a"/>'), "external reference"],
    [
      "an external url() fill",
      svg('<rect fill="url(https://evil.example/a#g)"/>'),
      "external reference",
    ],
    [
      "an external url() in style",
      svg("<rect style=\"fill:url('http://x/y')\"/>"),
      "external reference",
    ],
    ["a javascript: href", svg('<use href="java\tscript:alert(1)"/>'), "script or data URL"],
    ["a data: url", svg('<rect fill="url(data:image/png;base64,AAAA)"/>'), "external reference"],
    ["@import in style", svg("<rect style=\"@import 'x'\"/>"), "@import"],
    ["a CSS escape in style", svg('<rect style="fill:\\75 rl(x)"/>'), "a CSS escape"],
  ])("Given %s_When sanitized_Then it is refused and says why", (_, markup, reason) => {
    expect(refused(markup)).toContain(reason);
  });

  it("Given a style sheet with classes and a media query_When sanitized_Then it is kept", () => {
    const favicon = `<svg ${NS} viewBox="0 0 24 24"><style>.p{stroke:#1b1f29}@media (prefers-color-scheme:dark){.p{stroke:#e9ebf1}}</style><path d="M3 22" class="p"/></svg>`;
    expect(kept(favicon)).toBe(favicon);
  });

  it.each([
    ["@import", "<style>@import url(#a);</style>", "@import in a <style> element"],
    ["an external url()", "<style>.a{fill:url(http://x/y)}</style>", "external reference"],
    ["image-set", '<style>.a{fill:image-set("x.png" 1x)}</style>', "image-set"],
    ["a CSS escape", "<style>.a{fill:\\75 rl(x)}</style>", "a CSS escape"],
    ["CDATA with @import", "<style><![CDATA[@import 'x';]]></style>", "@import"],
  ])("Given a style element with %s_When sanitized_Then it is refused", (_, inner, reason) => {
    expect(refused(svg(inner))).toContain(reason);
  });

  it("Given the same attribute twice in different case_When sanitized_Then it is refused", () => {
    expect(refused(svg('<path d="M0 0" D="M1 1"/>'))).toContain(
      "repeats the attribute D on <path>",
    );
  });

  it("Given an upper-case XLINK:HREF_When sanitized_Then the xlink namespace is declared", () => {
    const out = kept(
      `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><defs><path id="p" d="M0 0"/></defs><use XLINK:HREF="#p"/></svg>`,
    );
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(out).toContain('<use xlink:href="#p"/>');
  });

  it("Given data or metadata in a selector or an id_When sanitized_Then it is kept", () => {
    const markup = svg(
      '<style>.metadata:hover{fill:red}.data:first-child{fill:blue}</style><path id="metadata:1" d="M0 0"/>',
    );
    expect(kept(markup)).toBe(markup);
  });

  it("Given a quoted data URL in CSS_When sanitized_Then it is refused", () => {
    expect(refused(svg("<style>.a{fill:'data:x'}</style>"))).toContain("script or data URL");
  });

  it("Given a DOCTYPE with entities_When sanitized_Then it is refused", () => {
    expect(refused(`<!DOCTYPE svg [<!ENTITY x "y">]><svg ${NS}><text>&x;</text></svg>`)).toContain(
      "DOCTYPE",
    );
  });

  it("Given malformed XML_When sanitized_Then it is refused as not well-formed", () => {
    expect(refused(`<svg ${NS}><g></svg>`)).toContain("not well-formed");
  });

  it("Given a root that is not svg_When sanitized_Then it is refused", () => {
    expect(refused(`<html><svg ${NS}/></html>`)).toContain("root element must be <svg>");
  });

  it("Given a file over the cap_When sanitized_Then it is refused with the cap", () => {
    const big = svg(`<desc>${"a".repeat(LOGO_LIMITS.svgBytes)}</desc>`);
    expect(refused(big)).toContain("over 64 KB");
  });

  it("Given nesting past the depth cap_When sanitized_Then it is refused", () => {
    const deep = svg("<g>".repeat(40) + "</g>".repeat(40));
    expect(refused(deep)).toContain("nested more than");
  });

  it("Given an attribute value with a quote_When sanitized_Then it is escaped in the output", () => {
    expect(kept(svg(`<text font-family='a"b'>x</text>`))).toContain('font-family="a&quot;b"');
  });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString(
  "base64",
);

describe("checkPng", () => {
  it("Given a PNG signature_When checked_Then it is kept as is", () => {
    expect(checkPng(PNG)).toEqual({ ok: true, data: PNG });
  });

  it("Given a GIF_When checked_Then it is refused as not a PNG", () => {
    expect(checkPng(Buffer.from("GIF89a....").toString("base64"))).toEqual({
      ok: false,
      reason: "the file is not a PNG",
    });
  });

  it("Given text that is not base64_When checked_Then it is refused", () => {
    expect(checkPng("<svg/>")).toMatchObject({ ok: false, reason: "the PNG is not valid base64" });
  });

  it("Given a PNG over the cap_When checked_Then it is refused with the cap", () => {
    const big = Buffer.concat([
      Buffer.from(PNG, "base64"),
      Buffer.alloc(LOGO_LIMITS.pngBytes),
    ]).toString("base64");
    expect(checkPng(big)).toMatchObject({ ok: false, reason: "the PNG is over 128 KB" });
  });
});

describe("checkLogo", () => {
  it("Given each format_When checked_Then it goes to its own check", () => {
    expect(checkLogo({ format: "png", data: PNG }).ok).toBe(true);
    expect(checkLogo({ format: "svg", data: svg("") }).ok).toBe(true);
    expect(checkLogo({ format: "svg", data: PNG }).ok).toBe(false);
  });
});
