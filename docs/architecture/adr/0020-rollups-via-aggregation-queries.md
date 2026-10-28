---
status: accepted
date: 2026-10-22
amends: 0017
---

# 0020 — Rollups computed with Firestore aggregation queries

## Context and Problem Statement

ADR-0017 allowed rollups (cost per ticket/epic/model/provider) to be either maintained when a run finishes or computed with aggregation queries. Leaving both open invites two code paths.

## Decision Outcome

v1.x computes rollups on read with Firestore aggregation queries (`count`/`sum`/`avg`). No denormalized counters. Revisit only if reads become measurably slow.

### Consequences

- Good: nothing to keep consistent; no write-path coupling between runs and tickets.
- Bad: each rollup needs a query shape (and possibly a composite index) designed up front; aggregation reads count against quota.
