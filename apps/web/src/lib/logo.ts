/**
 * The andy-intelligence mark (AI-392, concept C "A-peak"): an "A" drawn as a summit whose
 * crossbar is a wave. The one source of its geometry: the `Logo` component draws it inline and
 * `scripts/icons.ts` builds the favicon and app icons from it. 24-unit grid.
 */
export const LOGO_VIEWBOX = "0 0 24 24";

/** The summit: two legs meeting in a sharp (miter) peak. Stroked in the text colour. */
export const LOGO_PEAK = { d: "M3 22 L12 4.5 L21 22", strokeWidth: 3 } as const;

/** The wave crossbar, round-capped. Stroked in the `primary` token. */
export const LOGO_WAVE = { d: "M6.8 16.2 Q9.4 13.6 12 16.2 T17.2 16.2", strokeWidth: 2.4 } as const;
