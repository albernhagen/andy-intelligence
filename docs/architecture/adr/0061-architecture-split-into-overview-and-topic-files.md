---
status: accepted
date: 2026-11-04
amends: 0022, 0046
---

# 0061 — ARCHITECTURE split into an overview and per-topic files

Decided by Andy, 2026-11-04 (AI-17: Split ARCHITECTURE.md: short overview + per-topic detail files with their own budgets).

## Context and Problem Statement

`docs/architecture/ARCHITECTURE.md` reached its 11,000-word budget (ADR-0046: Context budget). It held design intent, as-built detail that grows with every slice, and the plan. Every slice that documented itself went over the budget, and on 2026-11-04 five parallel PRs conflicted on the one file.

## Decision

- `ARCHITECTURE.md` is the **overview** (≤ 3,000 words): goals and non-goals, principles, system diagram, a one-to-three-line summary under every numbered heading, technology, the milestone table, open questions, and a reading map that points at files.
- Detail lives in **topic files** under `docs/architecture/`, moved verbatim, with the same section numbers: `workflow.md` (§4), `domain-and-ports.md` (§5–§6), `api-and-mcp.md` (§7.1), `executors.md` (§7.2), `skills-and-scout.md` (§7.3–§7.4), `ui.md` (§7.5), `context-sources.md` (§7.6), `template-and-baseline.md` (§8, §8.1), `security.md` (§9), `observability-and-cost.md` (§10), `milestones.md` (§12 detail), `documentation.md` (§14).
- **Rule:** detail goes in the topic file. The overview changes only when design intent, a component list or the milestone table changes.
- Every numbered heading stays in the overview, so "ARCHITECTURE §N.M" references (ADRs, tickets, code comments) still resolve; the overview links on to the detail.
- Each topic file has its own budget in `context-budget.json`; a new `docs/architecture/*.md` file falls under a 1,500-word default. `docs/architecture/history/` stays unbudgeted.

Amends ADR-0046 (one budgeted ARCHITECTURE file → overview + topic files) and ADR-0022 (the doc that owns design is now the overview plus the topic file for the change).

## Consequences

- Parallel slices touch different topic files, so fewer conflicts; most slices never edit the overview.
- Agents load the overview and one or two topic files instead of an 11,000-word file.
- A section number is now a pointer: the heading in the overview, the detail in its file.
