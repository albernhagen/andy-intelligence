import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOGO_PEAK, LOGO_VIEWBOX, LOGO_WAVE } from "../src/lib/logo";

/**
 * AI-392: builds the favicon and app icons from the mark (`src/lib/logo.ts`) and the colour
 * tokens in `src/index.css`. Static files can't read CSS variables, so the tokens are converted
 * to hex here; `icons.test.ts` fails when the committed files drift from tokens or geometry.
 * Run `pnpm --filter @andy/web icons` after changing either (renders PNGs with Playwright).
 */

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** `oklch(L C h)` → `#rrggbb` (Björn Ottosson's OKLab matrices, sRGB gamma, clipped). */
export function oklchToHex(value: string): string {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(value);
  if (!m) throw new Error(`Not an oklch() colour: ${value}`);
  const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return (
    "#" +
    linear
      .map((x) => Math.round(Math.min(1, Math.max(0, gamma(x))) * 255))
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}

export interface IconColours {
  light: { foreground: string; primary: string; primaryForeground: string };
  dark: { foreground: string; primary: string };
}

/** The tokens the icons use, from the light `:root` block and the picked-dark block. */
export function iconColours(css: string): IconColours {
  const block = (start: string) =>
    css.slice(css.indexOf(start), css.indexOf("}", css.indexOf(start)));
  const token = (text: string, name: string) => {
    const m = new RegExp(`--${name}:\\s*(oklch\\([^)]*\\))`).exec(text);
    if (!m) throw new Error(`Token --${name} not found`);
    return oklchToHex(m[1]!);
  };
  const light = block(":root {");
  const dark = block(':root[data-theme="dark"] {');
  return {
    light: {
      foreground: token(light, "foreground"),
      primary: token(light, "primary"),
      primaryForeground: token(light, "primary-foreground"),
    },
    dark: { foreground: token(dark, "foreground"), primary: token(dark, "primary") },
  };
}

/** The two strokes; `peak` and `wave` are the paint attributes of each. */
const paths = (peak: string, wave: string) =>
  `<path d="${LOGO_PEAK.d}" fill="none" ${peak} stroke-width="${LOGO_PEAK.strokeWidth}"/>` +
  `<path d="${LOGO_WAVE.d}" fill="none" ${wave} stroke-width="${LOGO_WAVE.strokeWidth}" stroke-linecap="round"/>`;

/** The tab favicon: the bare mark, recoloured for a dark browser by `prefers-color-scheme`. */
export function faviconSvg(c: IconColours): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}">` +
    `<style>.p{stroke:${c.light.foreground}}.w{stroke:${c.light.primary}}` +
    `@media (prefers-color-scheme:dark){.p{stroke:${c.dark.foreground}}.w{stroke:${c.dark.primary}}}</style>` +
    paths('class="p"', 'class="w"') +
    `</svg>\n`
  );
}

/**
 * The app icon: the mark on a full-bleed `primary` square (iOS and Android round it themselves).
 * `scale` is the mark's share of the square: 0.62 for the usual icons, 0.5 for the maskable one,
 * whose outer 10% may be cropped.
 */
export function tileSvg(c: IconColours, scale: number): string {
  const offset = (24 - 24 / scale) / 2;
  const size = 24 / scale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${offset} ${offset} ${size} ${size}">` +
    `<rect x="${offset}" y="${offset}" width="${size}" height="${size}" fill="${c.light.primary}"/>` +
    paths(
      `stroke="${c.light.primaryForeground}"`,
      `stroke="${c.light.primaryForeground}" stroke-opacity="0.6"`,
    ) +
    `</svg>\n`
  );
}

/** Every committed icon: public path → SVG source and PNG size (none for the SVG itself). */
export function iconFiles(c: IconColours): { path: string; svg: string; px?: number }[] {
  const tile = tileSvg(c, 0.62);
  return [
    { path: "favicon.svg", svg: faviconSvg(c) },
    { path: "icons/favicon-32.png", svg: tile, px: 32 },
    { path: "icons/apple-touch-icon.png", svg: tile, px: 180 },
    { path: "icons/icon-192.png", svg: tile, px: 192 },
    { path: "icons/icon-512.png", svg: tile, px: 512 },
    { path: "icons/icon-maskable-512.png", svg: tileSvg(c, 0.5), px: 512 },
  ];
}

async function main() {
  const { chromium } = await import("@playwright/test");
  const colours = iconColours(readFileSync(here("../src/index.css"), "utf8"));
  const browser = await chromium.launch();
  try {
    for (const file of iconFiles(colours)) {
      const out = here(`../public/${file.path}`);
      if (!file.px) {
        writeFileSync(out, file.svg);
      } else {
        const page = await browser.newPage({ viewport: { width: file.px, height: file.px } });
        const html = `<style>*{margin:0}svg{display:block;width:100vw;height:100vh}</style>${file.svg}`;
        await page.setContent(html);
        await page.screenshot({ path: out, omitBackground: false });
        await page.close();
      }
      console.log(`wrote public/${file.path}`);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
