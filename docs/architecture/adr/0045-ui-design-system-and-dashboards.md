---
status: accepted, amended by 0059 (timing of design.md, tokens and screenshot checks)
date: 2026-11-03
---

# 0045 — UI design system, pluggable design skills (Hallmark first) and dashboards, in M5

Decided by Andy, 2026-11-03.

## Context and Problem Statement

The control-plane UI (M1.3: UI: tickets + inbox) is plain shadcn defaults, and goal 9 (digestible rollups) has no screen yet. Andy wants the plan to cover better UI design, using a design skill such as [Hallmark](https://www.usehallmark.com/), and dashboards later.

Hallmark (checked 2026-11-03: site and `github.com/Nutlope/hallmark`):

| Topic  | Fact                                                                                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What   | MIT-licensed design skill for Claude Code, Codex and OpenCode (`npx skills add nutlope/hallmark`); 50 themes; build, `redesign <path>` and audit modes; reads a locked `design.md` |
| Checks | `sloplint` flags machine-made design tells; `--render` checks 8 widths in a real browser (needs `puppeteer-core` + Chrome); `--before`/`--kept` guard redesigns                    |
| Fit    | Output and examples are self-contained HTML/CSS marketing and product pages. No mention of React, Tailwind, shadcn, data-dense screens or dashboards                               |

## Decision Outcome

All in **M5: Epics + story board** (the UI milestone), when multi-project run data exists (M1.8: Build + gate records the metrics, ADR-0040; M2: Multi-project in parallel adds projects).

| Piece                  | Decision                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design source of truth | `apps/web/design.md` plus the shadcn theme tokens: type, colour, spacing, density rules for data-heavy screens. Every design skill and agent reads it; managed projects get a seed `design.md` through the baseline.                                                                                                         |
| Design skills          | Pluggable, per project, as a "custom skill" context source (ADR-0033: Pluggable context sources). Hallmark is the first candidate: a timeboxed trial of `redesign` on one control-plane screen (Needs-you inbox) decides keep or drop for app UI. It fits managed projects' landing pages as is.                             |
| Visual checks          | Playwright browser tests with screenshots (already a follow-up from M1.3) and `sloplint --render` as a non-blocking report. Matches ADR-0040's UI loop: build → screenshot → compare.                                                                                                                                        |
| Dashboards             | A Dashboards screen: delivery (tickets by stage over time, lead time, rework, CI green on first try, review blockers), cost and quota over time, per project and overall. Data from Firestore aggregation queries (ADR-0020); charts with shadcn charts (already chosen, §11). DORA metrics stay in M6: Dev → prod releases. |

### Consequences

- Good: one design source of truth any agent or skill can follow; a design skill can be swapped without code changes; dashboards land when there is data to show.
- Bad: the UI stays plain until M5; Hallmark may not suit a React/shadcn app (the trial decides); the visual checks add Chrome to CI.
