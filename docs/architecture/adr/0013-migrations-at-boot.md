---
status: superseded by 0017
date: 2026-10-21
---

# 0013 — Apply DB migrations at service boot

## Context and Problem Statement

CI has no database credentials (and shouldn't). A separate Cloud Run Job for migrations is more infra than one user needs.

## Decision Outcome

When `RUN_MIGRATIONS=true` and `DATABASE_URL` is set, the API applies pending Drizzle migrations before listening. Drizzle records applied migrations, so restarts are no-ops. With max 2 instances, concurrent boots are possible; Drizzle runs migrations in a transaction, and migrations must stay additive/idempotent.

Revisit (move to a Cloud Run Job) if a migration ever needs to be long-running or non-transactional.

### Consequences

- Good: zero extra infra; deploy = migrate.
- Bad: a bad migration fails the new revision's startup (Cloud Run keeps serving the old revision, which is the safe failure).
