import { LOGO_LIMITS, type SetProjectLogo } from "@andy/contracts";
import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * Logo upload checks (AI-393). An upload is untrusted. A PNG must carry the PNG signature and fit
 * the cap. An SVG is parsed and rebuilt from an allowlist: anything dangerous (scripts, event
 * handlers, external references, CSS that imports or escapes, DOCTYPEs) refuses the whole file with the reason;
 * anything else outside the allowlist (editor metadata, unknown attributes) is dropped. Only the
 * rebuilt markup is stored. The web still shows it through `<img>`, which runs no script and
 * loads nothing external: this is the second line, and the one a repo copy relies on.
 */

export type LogoCheck = { ok: true; data: string } | { ok: false; reason: string };

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
/** Parser-bomb caps (ADR-0028). */
const MAX_DEPTH = 32;
const MAX_ELEMENTS = 4000;

/** Refused, with the reason given back: what an attacker would reach for. */
const REFUSED_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "image",
  "feimage",
  "a",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
  "handler",
  "listener",
]);

/** Kept: drawing elements only. Others are dropped with their content. */
const ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "desc",
  "defs",
  "symbol",
  "use",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "style",
]);

/** Elements whose text content is kept; a style sheet only after `checkCss`. */
const TEXT_ELEMENTS = new Set(["text", "tspan", "title", "desc", "style"]);

/** Kept attributes; others are dropped. `href` values are checked further below. */
const ATTRIBUTES = new Set([
  "id",
  "class",
  "viewbox",
  "preserveaspectratio",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "dx",
  "dy",
  "d",
  "points",
  "transform",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "color",
  "display",
  "visibility",
  "clip-path",
  "clip-rule",
  "clippathunits",
  "mask",
  "maskunits",
  "maskcontentunits",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "style",
  "href",
  "xlink:href",
]);

type Node = Record<string, unknown> & { ":@"?: Record<string, string> };

const refuse = (reason: string): LogoCheck => ({ ok: false, reason });

export function checkLogo(input: SetProjectLogo): LogoCheck {
  return input.format === "png" ? checkPng(input.data) : sanitizeSvg(input.data);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function checkPng(base64: string): LogoCheck {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    return refuse("the PNG is not valid base64");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > LOGO_LIMITS.pngBytes) {
    return refuse(`the PNG is over ${LOGO_LIMITS.pngBytes / 1024} KB`);
  }
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return refuse("the file is not a PNG");
  }
  return { ok: true, data: base64 };
}

export function sanitizeSvg(markup: string): LogoCheck {
  if (Buffer.byteLength(markup, "utf8") > LOGO_LIMITS.svgBytes) {
    return refuse(`the SVG is over ${LOGO_LIMITS.svgBytes / 1024} KB`);
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(markup)) {
    return refuse("the SVG has a DOCTYPE or entity declarations, which are not allowed");
  }
  const valid = XMLValidator.validate(markup);
  if (valid !== true) return refuse(`the SVG is not well-formed XML: ${valid.err.msg}`);
  const parsed = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
    processEntities: true,
    htmlEntities: false,
  }).parse(markup) as Node[];
  const roots = parsed.filter((n) => elementName(n) !== null);
  if (roots.length !== 1 || elementName(roots[0]!)?.toLowerCase() !== "svg") {
    return refuse("the file is not an SVG: its root element must be <svg>");
  }
  const counter = { elements: 0 };
  try {
    const body = rebuild(roots[0]!, 0, counter);
    return { ok: true, data: body ?? `<svg xmlns="${SVG_NS}"/>` };
  } catch (error) {
    if (error instanceof Refusal) return refuse(error.message);
    throw error;
  }
}

class Refusal extends Error {}

/** A node's element name, or null for text, comments and processing instructions. */
function elementName(node: Node): string | null {
  const name = Object.keys(node).find((k) => k !== ":@");
  if (!name || name.startsWith("#") || name.startsWith("?")) return null;
  return name;
}

function rebuild(node: Node, depth: number, counter: { elements: number }): string | null {
  const name = elementName(node)!;
  const local = name.toLowerCase();
  if (REFUSED_ELEMENTS.has(local) || REFUSED_ELEMENTS.has(localName(local))) {
    throw new Refusal(`the SVG has a <${name}> element, which is not allowed`);
  }
  if (depth > MAX_DEPTH) throw new Refusal(`the SVG is nested more than ${MAX_DEPTH} deep`);
  if (++counter.elements > MAX_ELEMENTS) {
    throw new Refusal(`the SVG has more than ${MAX_ELEMENTS} elements`);
  }
  const attrs = checkAttributes(name, node[":@"] ?? {});
  // Dropped (e.g. `metadata`, `sodipodi:namedview`), but still checked for refused content.
  const kept = ELEMENTS.has(local);
  const children = (node[name] as Node[]).flatMap((child) => {
    if ("#text" in child) {
      const text = String(child["#text"]);
      if (local === "style") checkCss("a <style> element", text);
      return kept && TEXT_ELEMENTS.has(local) ? [escapeText(text)] : [];
    }
    if (elementName(child) === null) return [];
    const built = rebuild(child, depth + 1, counter);
    return built === null ? [] : [built];
  });
  if (!kept) return null;
  if (local === "svg" && depth === 0) {
    attrs.unshift(["xmlns", SVG_NS]);
    if (usesXlink(attrs, children)) {
      attrs.splice(1, 0, ["xmlns:xlink", XLINK_NS]);
    }
  }
  const open = `<${canonical(local)}${attrs
    .map(([k, v]) => ` ${k}="${escapeAttribute(v)}"`)
    .join("")}`;
  return children.length === 0 ? `${open}/>` : `${open}>${children.join("")}</${canonical(local)}>`;
}

/** Keeps the allowed attributes in SVG's own spelling; refuses dangerous ones. */
function checkAttributes(element: string, raw: Record<string, string>): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const [key, rawValue] of Object.entries(raw)) {
    const name = key.toLowerCase();
    const value = String(rawValue);
    if (localName(name).startsWith("on")) {
      throw new Refusal(
        `the SVG has an event handler (${key} on <${element}>), which is not allowed`,
      );
    }
    if (seen.has(name)) {
      throw new Refusal(`the SVG repeats the attribute ${key} on <${element}>`);
    }
    seen.add(name);
    // A script or data URL only where a URL starts: the value itself, or (below) inside url().
    if (SCHEME.test(squeeze(value))) {
      throw new Refusal(`the SVG has a script or data URL in ${key} on <${element}>`);
    }
    if (localName(name) === "href") {
      if (!value.trim().startsWith("#")) {
        throw new Refusal(`the SVG has an external reference (${key}="${value.slice(0, 60)}")`);
      }
    }
    checkUrls(value);
    if (name === "style") checkCss(`a style attribute on <${element}>`, value);
    if (!ATTRIBUTES.has(name)) continue;
    out.push([canonical(name), value]);
  }
  return out;
}

/** Every `url(...)` must point inside the file (`#id`). */
function checkUrls(value: string): void {
  for (const match of value.matchAll(/url\(\s*['"]?([^'")]*)/gi)) {
    if (!match[1]!.trim().startsWith("#")) {
      throw new Refusal(`the SVG has an external reference (url(${match[1]!.slice(0, 60)}))`);
    }
  }
}

/**
 * CSS in a style element or attribute: only internal `url(#id)`, and nothing that loads, runs or
 * hides from these checks (`@import`, `image-set`, `expression()`, escapes, script schemes).
 */
function checkCss(where: string, css: string): void {
  // Outside url() (checked below), a URL in CSS can only start a quoted string.
  if (/['"](?:javascript|vbscript|data):/i.test(squeeze(css))) {
    throw new Refusal(`the SVG has a script or data URL in ${where}`);
  }
  checkUrls(css);
  const found = /@import|image-set|expression\s*\(|\\/i.exec(css);
  if (found) {
    throw new Refusal(
      `the SVG has ${found[0] === "\\" ? "a CSS escape" : found[0]} in ${where}, which is not allowed`,
    );
  }
}

/** Whether the rebuilt element or its children use `xlink:href`: names are case-folded by then. */
function usesXlink(attrs: [string, string][], children: string[]): boolean {
  return (
    attrs.some(([k]) => k === "xlink:href") || children.some((c) => c.includes(' xlink:href="'))
  );
}

/** A value that starts with a script or data URL. */
const SCHEME = /^(?:javascript|vbscript|data):/i;

/** The value without whitespace or control characters, which browsers skip inside a scheme. */
const squeeze = (value: string) =>
  [...value].filter((ch) => ch.charCodeAt(0) > 0x20 && ch.charCodeAt(0) !== 0x7f).join("");

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

/** SVG names are case-sensitive: lowercased allowlist keys back to SVG's camelCase. */
const CANONICAL: Record<string, string> = {
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  clippathunits: "clipPathUnits",
  maskunits: "maskUnits",
  maskcontentunits: "maskContentUnits",
  gradientunits: "gradientUnits",
  gradienttransform: "gradientTransform",
  spreadmethod: "spreadMethod",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  clippath: "clipPath",
};
const canonical = (name: string) => CANONICAL[name] ?? name;

const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (s: string) => escapeText(s).replace(/"/g, "&quot;");
