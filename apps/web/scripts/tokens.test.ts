// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** AI-367: the tokens' theme and motion rules in src/index.css (ADR-0151). */

const css = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");

describe("theme tokens", () => {
  it("GivenTheTokens_WhenRead_ThenDarkFollowsTheOsUnlessLightIsPickedAndAPickedDarkWins", () => {
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) {\s*:root:not\(\[data-theme="light"\]\) {/,
    );
    expect(css).toContain(':root[data-theme="dark"] {');
  });
});

describe("motion", () => {
  it("GivenReducedMotion_WhenTheStylesApply_ThenAnimationsAndTransitionsTakeNoTime", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/animation-duration: 0s !important/);
    expect(block).toMatch(/transition-duration: 0s !important/);
  });

  it("GivenTheMotionTokens_WhenRead_ThenTheyStayBetween120And180ms", () => {
    const durations = [...css.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));
    expect(durations.length).toBeGreaterThan(0);
    for (const ms of durations) expect(ms).toBeGreaterThanOrEqual(120);
    for (const ms of durations) expect(ms).toBeLessThanOrEqual(180);
  });

  it("GivenTheEnterAnimation_WhenRead_ThenItMovesOnlyOpacityAndTransform", () => {
    const keyframes = css.slice(css.indexOf("@keyframes enter"));
    const body = keyframes.slice(0, keyframes.indexOf("}\n  }") + 1);
    const props = [...body.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
    expect(new Set(props)).toEqual(new Set(["opacity", "transform"]));
  });
});
