---
title: "Milestones: a project's ordered groups of epics, with a status Andy sets"
status: accepted (Andy, 2026-11-25); amended by 0136 (five MCP milestone tools); extended by 0149 (a case on every milestone)
date: 2026-11-21
amends: 0058 (ticket model), 0108 (roadmap over epics)
---

# 0131 — Milestones: Project → Milestone → Epic → Ticket

AI-301: M4.32: Milestones: design, under AI-84: M4: Epics + story board. Andy, 2026-11-21: "Seems like a milestone is a grouping of epics. That should be a first class citizen. And then we could build a simple roadmapping view in the UI?" and "you should only use terminology in the system. If slice isn't a thing, let's not use it." He also wants a milestone's approved or parked status in the UI and over MCP (AI-281: Milestone review and approval, part 2). Three questions are on AI-301; this ADR is written with the recommended answers.

## Context and Problem Statement

A milestone is an epic today (ADR-0060, ADR-0108), so it can't hold several epics, has no status, and nothing stops dispatch or a coordinator from starting work Andy hasn't chosen (AI-281). Docs, tickets and agent rules also use words the system has no entity for ("slice", "story").

## Decision Outcome

| Topic     | Decision                                                                                                                                                                                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model     | A **milestone** belongs to a project: name, outcome (at most 300 characters), order, status. A top-level epic belongs to at most one milestone; a child epic and every ticket take the milestone of their top-level epic. Nested epics stay as they are (one level). Cap: 50 milestones per project (ADR-0028). |
| Status    | Stored: `not_reviewed` (new milestones), `approved`, `parked`. **Done** is computed: an approved milestone whose epics are all Done shows as done, and reopens if an open epic is added.                                                                                                                        |
| No home   | A ticket with no epic, or whose epic has no milestone, has no milestone. It runs as today, and the roadmap lists such epics under "No milestone".                                                                                                                                                               |
| Rules     | Dispatch (refine, build, night launch) and coordinator sessions start a ticket only if its milestone is approved or it has none. A ticket held back stays in place, with "Milestone <name> is parked" (or not reviewed) as its reason.                                                                          |
| Who       | Only the owner creates, edits, orders or sets the status of a milestone, or attaches an epic, in the UI or over MCP. Each change is a config change (entity `milestone`, AI-118): logged with who and when, revertable. Agent tasks get no milestone tools.                                                     |
| UI        | A roadmap: milestones in order with status and progress, each expanding to its epics and their progress, parked ones dimmed, done ones compact. The epic panel and the board's epic groups show the milestone and its status.                                                                                   |
| MCP       | `list_milestones`, `set_milestone_status`, `set_epic_milestone`; `roadmap` (AI-193) returns milestones, then epics. API and MCP share one domain service; parity tests prove the same data and the same refusals.                                                                                               |
| Migration | No ticket moves or re-ranks: one milestone per ARCHITECTURE §12 milestone (M0 to M10), each existing `M<N>: …` epic attached as its one epic. Statuses: approved M0 to M5 and M10 (M0 to M3 read as done once their epics are); parked M6, M7, M8, M9.                                                          |
| Terms     | One glossary: project, milestone, epic, ticket (types: feature, chore, bug, spike, epic). "Slice" and "story" leave UI text, docs, agent rules and ticket titles; ADR bodies stay as written.                                                                                                                   |

ADR-0108 decision 1 changes: the roadmap's rows are milestones, not top-level epics. Its decisions 2 to 5 stand.

**Tickets** (AI-84), after this ADR merges: AI-302: M4.33 entity and store → AI-304: M4.34 API and MCP, AI-305: M4.35 roadmap read (also after AI-193) and AI-306: M4.36 dispatch rule, in parallel → AI-202: M4.26 roadmap screen and AI-311: M4.38 epic panel and board, in parallel; AI-307: M4.37 creates project AI's milestones (after M4.34); AI-205: M4.27 glossary and terms last.

### Consequences

- Good: Andy approves or parks a milestone in one place, and dispatch, coordinators, the roadmap and MCP all read it; several epics can share a milestone; no ticket moves.
- Bad: a ticket's milestone is read through its top-level epic, so dispatch reads the epic chain for each candidate (already loaded for overrides, ADR-0059). A session acting as Andy over MCP can approve a milestone; every change is logged and revertable (risk R-AI-301).
