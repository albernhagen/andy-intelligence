---
status: superseded by 0017
date: 2026-10-21
---

# 0008 — Postgres on Neon free tier, Drizzle ORM

## Considered Options

1. Neon free tier ($0, external SaaS).
2. Cloud SQL smallest instance (~$10+/month, GCP-native).

## Decision Outcome

Neon free tier, accessed over TLS with `pg` + Drizzle (`drizzle-orm/node-postgres`). Connection string lives only in Secret Manager secret `control-plane-database-url`; Andy adds the version, Terraform only creates the container.

Migrations are generated with `drizzle-kit generate` into `packages/db/drizzle` and committed. They are applied at service boot when `RUN_MIGRATIONS=true` (ADR-0013).

### Consequences

- Good: $0; serverless scale-to-zero matches Cloud Run.
- Bad: a dependency outside GCP; possible cold-start latency on the first query after idle. Migrating to Cloud SQL later is a dump/restore plus a secret swap.
