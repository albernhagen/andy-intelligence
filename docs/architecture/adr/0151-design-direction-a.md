---
title: 'Design direction A "Instrument": tokens, one typeface, motion that explains, a theme switch'
status: accepted (AI-367; Andy approved direction A at the 2026-11-23 design review)
date: 2026-11-23
supersedes: parts of 0045 (the design tokens) and 0059 (fast means nothing animates; no per-user themes)
---

# 0151 — Design direction A "Instrument"

AI-367: Design direction A: tokens, type scale, surfaces, motion and theme switch; rewrite design.md, under AI-357: Design and UX: a best-in-class UI across the whole system (milestone M11: Design system and UI rebuild). At the 2026-11-23 design review (`docs/build-log/2026-11-23-design-review.md`) Andy compared three directions in mockups and approved A, "Instrument".

## Context and Problem Statement

The UI used greyscale shadcn defaults: eight colour roles all grey, a black main button, the system font in four sizes, no surface levels or selected state, and dark mode only from the OS. ADR-0059 read "fast" as "nothing animates" and left per-user themes out. The review found screens hard to scan and no rule for where a write landed.

## Decision Outcome

| Topic    | Decision                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Colour   | Tokens in `apps/web/src/index.css` from the direction A mockup: neutrals tinted toward hue 270, an indigo accent (`primary`) that is not black, role colours (attention, running, success, destructive) as tints. Light and dark.                                  |
| Surfaces | Three levels: sunken (`muted`: side areas, lanes, hovered rows), base (`background`: the page), raised (`raised`: cards, panels, menus). A selected state (`selected`, edge `selected-edge`) for the picked row, option or tab.                                    |
| Type     | One face, Inter (13 px body), plus Geist Mono for keys and numbers. Six sizes: 11, 12, 13, 14, 16 (phone inputs), 19 px. Both fonts are bundled with the app (OFL; licences in `public/fonts/`): no request to a third-party host; the build fails if one appears. |
| Radii    | 4 px (keys), 7 px (controls), 9 px (cards, menus).                                                                                                                                                                                                                 |
| Motion   | Motion explains a change: 120 to 180 ms, opacity and transform only, off under `prefers-reduced-motion`, never delays input. Replaces ADR-0059's "nothing animates"; "fast" still means moves apply at once.                                                       |
| Theme    | A switch in the shell's Settings menu (More on a phone): system, light, dark. Applies at once; remembered in the browser (local storage, no server field). Replaces ADR-0059's "no per-user themes".                                                               |
| Layout   | Three page templates replace "content is full width": list with detail, settings with section nav, reading page. Screens move to them in later tickets (AI-370 and the screen tickets).                                                                            |
| Feedback | Every write confirms where it happened (components: AI-369).                                                                                                                                                                                                       |
| Kept     | Density, sentence case, role colours as tints, status visible without opening anything, the copy rules.                                                                                                                                                            |

ADR-0045's design source of truth (`apps/web/design.md` plus the tokens) stands; its tokens are now these. ADR-0059's other decisions stand.

### Consequences

- Good: screens read faster (surfaces, a selected state, one accent); the theme suits the room; every stored screenshot shows the new look.
- Bad: the fonts ship with the app (a page in English loads about 71 KB: Inter and Geist Mono latin; other subsets load only when a page uses them); every stored screenshot changes once; a choice that differs from the OS can flash the OS theme for one frame on load.
