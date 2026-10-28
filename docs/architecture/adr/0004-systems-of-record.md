---
status: superseded by 0016
date: 2026-10-21
---

# 0004 — GitHub owns work; Postgres owns config, runs, questions and spend

## Context and Problem Statement

Two stores invite drift. ARCHITECTURE §2 splits ownership; this ADR pins down what the Postgres ticket mirror holds.

## Decision Outcome

- GitHub is authoritative for ticket content: title, body, type, parent/sub-issues, dependencies, stage (board Status field).
- Postgres `tickets` is a **thin mirror**: external ref, stage, size, tier, overrides, `needs_you`, `dor_met`, `synced_at`. Never edit ticket content in Postgres and push it to GitHub; write to GitHub, then let the webhook/reconciler update the mirror.
- Postgres is authoritative for questions, runs, config, quota readings, config changes and releases.
- The control plane is stateless apart from Postgres; the reconciler heals drift.

### Consequences

- Good: one direction of truth per field; reconciler logic stays simple.
- Bad: UI reads of ticket content go through GitHub (or a cache), adding latency.
