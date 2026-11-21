---
title: Roadmap over epics; five fixed work views
status: proposed
date: 2026-11-20
amends: 0059 (five fixed work views are built; custom views and saved filters stay not built)
---

# 0108 — Roadmap view over epics, and fixed work views

Andy, 2026-11-20: he wants milestones and plans visible in the UI ("the noise of individual tickets will be too high") and a way to see tickets that need him, are his or the agents', or are blocked. Slices: M4.24 to M4.31 under AI-84: M4: Epics + story board (`m4-slices.md`).

## Context and Problem Statement

Milestones are epic tickets (ADR-0060), with a children list and roll-up in the epic panel (AI-85: M4.1: Epic panel) and grouping on the board (AI-86: M4.2: Board: group by epic). No screen shows them side by side. The overview is hand-kept markdown, the build-log milestone map and one slice table per milestone, which drifts and conflicts. Cards carry worker and blocker markers (ADR-0082) but the board can't be narrowed to them, and nothing lists them across projects.

## Decision Outcome

Andy chose these on 2026-11-20; the options he turned down are in `docs/build-log/2026-11-20-roadmap-and-work-views-sliced.md`.

1. **The roadmap is a project's top-level epics, in rank order**, child epics nested one level. No new entity: a milestone is an epic. It is computed on read and never stored, extending the milestone map of AI-148: Milestone map generated from tickets. Reads are capped (ADR-0028): the ticket list once per project, no agent-task reads; cost stays on the epic's own roll-up.
2. **The summary is stored once; the status is computed.** An epic gains one optional field, `outcome`: at most 300 characters saying what is true when it is done. Its "Done when" list is its acceptance criteria, shown under that name on epics. "Where it stands" is counted from its stories: done of total, needs you, in review, in progress, blocked, not started. The schema change is additive (ADR-0035).
3. **An agent-written "what changed" paragraph comes later** (M4.30), capped, after the view has been used.
4. **The roadmap replaces the hand-kept maps.** Once the screen ships, the per-milestone slice tables (`m4-slices.md`, `m5-slices.md` and later ones) are deleted. `milestones.md` keeps each milestone's scope and "Done when"; tickets hold the slices. AI-148 removes the build-log map.
5. **Five fixed work views.** One rule in `packages/domain` serves the board's chips, the cross-project list `/all/work` and MCP `list_work`. A ticket can be in several views.

| View      | An open ticket (not Done, Cancelled or archived) that…          |
| --------- | --------------------------------------------------------------- |
| Needs me  | has a card in the Needs-you inbox, or needs a worker (ADR-0082) |
| Mine      | is not an epic and whose worker is Andy                         |
| Agents    | is not an epic and whose worker is an agent                     |
| Blocked   | has a blocker that is not Done                                  |
| In review | is in Ready for review                                          |

ADR-0059's "Not built: custom views, saved filters" stands: these are presets in code, with no editor and nothing stored per user.

### Consequences

- Good: one screen shows every milestone's outcome and state without reading tickets or markdown; nothing is kept in sync by hand; no agent spend.
- Good: "what needs me" is one rule shared by the board, the cross-project list and MCP.
- Bad: an epic without an `outcome` shows only its title until someone writes one. M4.31 has ideate and refine fill it.
- Bad: "a PR only Andy may merge" is not a stored fact (ADR-0092's list is applied by hand). Such a ticket shows under In review, and under Needs me only when the gate flagged it.
- Bad: roadmap order is ticket rank, so reordering milestones means changing ranks as well as the ADR that ADR-0060 requires.
