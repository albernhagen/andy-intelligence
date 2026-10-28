---
status: accepted
date: 2026-10-21
---

# 0001 — Record architecture decisions as MADR

## Context and Problem Statement

Decisions get made by Andy and by agents building this system. They need to be findable and immutable.

## Decision Outcome

Use MADR files in `docs/architecture/adr/NNNN-title.md`. ADRs are immutable once accepted; changes are made by a new ADR that supersedes the old one. `docs/architecture/ARCHITECTURE.md` stays the high-level source of truth; ADRs record the why and any deviation.

### Consequences

- Good: agents and Andy can cite decisions by number.
- Bad: small overhead per decision. Only notable decisions get ADRs.
