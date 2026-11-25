---
title: "Milestone create and edit over MCP: five milestone tools, not three"
status: accepted (Andy, 2026-11-25)
date: 2026-11-21
amends: 0131 (milestones)
---

# 0136 — Milestone create and edit over MCP

AI-321: Milestone create and edit over MCP, under AI-84: M4: Epics + story board.

## Context

ADR-0131: Milestones names three MCP milestone tools: `list_milestones`, `set_milestone_status`, `set_epic_milestone`. AI-304: M4.34: Milestone API and MCP tools built those, plus web routes that also create, rename, reword and reorder a milestone. So those four writes are web only, and the parity registry (AI-300) marks them as a gap.

## Decision

Add two owner-only MCP tools over the same `MilestoneService` as the routes:

| Tool               | Does                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `create_milestone` | Creates one: name, outcome, optional order (default: after the last); starts not reviewed |
| `edit_milestone`   | Changes any of name, outcome, order (status stays with `set_milestone_status`)            |

Same rules as every milestone write: the owner action `change_milestones`, at most 50 milestones per project, each write logged in the project's change log and revertable there. No delete tool: there is no delete route; park a milestone instead.

## Why

- The web UI and MCP are both first-class: Andy can do the same thing in either (AI-285: Web UI and MCP parity).
- ADR-0131's own ticket list has AI-307 creating project AI's milestones over MCP, which needs `create_milestone`.

## Consequences

- MCP has five milestone tools; the parity registry matches `POST` and `PATCH …/milestones` to them and drops the AI-321 pending mark.
- Agent tasks still get none: agents have no MCP tools.
- ADR-0131's body is unchanged; its status notes this amendment.
