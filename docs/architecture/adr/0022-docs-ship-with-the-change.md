---
status: accepted
date: 2026-10-22
---

# 0022 — Docs ship with the change

## Context and Problem Statement

The system is built by agents across many sessions; each session starts cold and trusts the docs. Stale docs cost more here than in a human team: a new session builds against a design that no longer exists. The architecture went through several revisions in M0 alone.

## Decision Outcome

- Every PR updates the docs its change affects, in the same PR. ARCHITECTURE §14 maps each doc to what it owns and when it changes.
- `AGENTS.md` at the repo root (with `CLAUDE.md` symlinked to it) carries the short always-loaded rules and the doc map, so every harness sees them without the build prompt.
- The PR template has a docs checklist; "n/a" is an answer, unticked is not.
- ARCHITECTURE.md front matter carries `revision` and `last_updated`, bumped on every content change. ADR bodies stay immutable; decisions change via new ADRs and status updates.
- **Style:** concise, plain, readable without context. Lead with the point; tables and lists over prose; define terms and IDs where used; no filler.
- The repo is canonical. The claude.ai Project keeps reference copies of ARCHITECTURE.md and BUILD-PROMPT.md, refreshed when the revision changes.
- Managed projects inherit the rule through the template (`docs/features.md` on merge, `docs/architecture/overview.md` on design change).

No CI check enforces this for now; review does. Add a check if drift shows up.

### Consequences

- Good: each session starts from accurate docs; decisions stay traceable.
- Bad: slightly larger PRs; relies on review discipline until a check exists.
