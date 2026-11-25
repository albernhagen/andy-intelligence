import { expect } from "vitest";

/**
 * AI-369: a component renders from tokens only (design.md "Surfaces and colour") and moves only
 * with the motion tokens (design.md "Motion"). Pass the rendered HTML.
 */
export function expectTokensOnly(html: string) {
  expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(html).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/);
  expect(html).not.toMatch(/\bdark:/);
  expect(html).not.toMatch(
    /\b(bg|text|border|ring|outline|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/,
  );
  expect(html).not.toMatch(/\b(bg|text|border)-(white|black)\b/);
}

/** No animation but `animate-enter` (150 ms), no transition longer than 180 ms. */
export function expectTokenMotion(html: string) {
  for (const [, name] of html.matchAll(/\banimate-([a-z-]+)/g)) expect(name).toBe("enter");
  for (const [, ms] of html.matchAll(/\bduration-(\d+)/g))
    expect(Number(ms)).toBeLessThanOrEqual(180);
}
