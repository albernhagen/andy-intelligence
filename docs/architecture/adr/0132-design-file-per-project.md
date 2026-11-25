---
title: "Every project gets a design file now; pluggable design skills move to Later"
status: accepted (Andy, 2026-11-25)
date: 2026-11-21
amends: 0045 (Design skills row; timing of the managed projects' seed design.md)
---

# 0132 — Every project gets a design file now; pluggable design skills move to Later

AI-128: M4.15: Every project has its own design file that agents follow.

## Context and Problem Statement

ADR-0045 planned two things for UI design: one design source of truth (`design.md`), with a seed copy for managed projects through the baseline, and design skills (a packaged design method such as Hallmark) pluggable per project as a "custom skill" context source (ADR-0033). This repo has its design file (`apps/web/design.md`, ADR-0059) and its agents follow it. A managed project gets none: the baseline wrote no design file and nothing told its agents to follow one. The context-source design that pluggable skills ride on is not done.

Andy, 2026-11-21: "We do need designs per project, might be required." He re-scoped AI-128 to a design file per project.

## Decision Outcome

| Piece                | Decision                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design file, now     | The baseline seeds `design.md` at a managed project's root from `template/design.md` (create only: written once, never overwritten; the project owner edits it). Short and generic: layout, type, colour, components, states, accessibility, tone.                                                                                                                                                        |
| Agent rules          | The managed `AGENTS.md` template: a ticket that changes a UI follows `design.md`; on a contradiction an interactive session asks, an unattended build records a deviation and carries on.                                                                                                                                                                                                                 |
| Brief                | The onboarding interview asks for the design direction and where the design file lives (`design`, optional in `BriefAnswers` so older answer sets still parse); the brief's Architectural expectations carry it, within that section's 200 words (raising the cap would push a brief at every cap past its 800), so plan and build runs read it (ADR-0117). This repo's brief names `apps/web/design.md`. |
| Build task           | The build prompt names the design file in its fixed text for every ticket (the repo is checked out; no executor or sandbox change). A headless build can't ask, so a contradiction goes in `deviations` for Andy.                                                                                                                                                                                         |
| Design skills, Later | Pluggable design skills and choosing a design method per project move to Later, with the `ContextSource` port (ADR-0033). The Hallmark trial (AI-126: M4.13) says whether one is worth having.                                                                                                                                                                                                            |

### Consequences

- Good: every managed project starts with a design file its agents follow, from day one, with no new port or setting.
- Bad: the starter file is generic until the owner edits it; a project with a design file elsewhere must name its path in the brief or `AGENTS.md`.
