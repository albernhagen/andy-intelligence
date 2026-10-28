---
status: accepted, amended by 0020
date: 2026-10-21
supersedes: 0008, 0013
---

# 0017 — Firestore for the control-plane database; event-driven flow, no polling

## Context and Problem Statement

With work tracking native (ADR-0016), the data is documents keyed by project, ticket and run: tickets with their history, questions, runs with model/cost/outcome, config, and quota readings. Andy is the only user, and volume is hundreds to low thousands of runs. The earlier Postgres choice assumed periodic reconcile jobs and ad-hoc SQL analytics. Andy pointed out the system can be event-driven, so nothing needs to poll.

## Considered Options

| Option                             | Cost                                                                                                | Notes                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Firestore** (Native, default DB) | $0 within free quota (1 GiB, 50k reads / 20k writes per day)                                        | GCP-native, Terraform-managed, IAM auth (no connection secret), no cold start; no joins |
| Neon Postgres                      | $0 within free quota (compute-hours capped)                                                         | Full SQL; extra vendor, connection-string secret, ~1s cold start                        |
| Cloud SQL db-f1-micro              | ≈ $9.50/month (us-central1: ~$7.67 instance + ~$1.70 for 10 GB SSD + backups); never scales to zero | GCP-native SQL; shared core, no SLA                                                     |

## Decision Outcome

**Firestore** in Native mode, the `(default)` database (only the default database gets the free tier), in `us-central1`, delete protection enabled.

- **Schema = contracts.** Documents are validated by the Zod schemas in `packages/contracts` through a converter on every read and write (`packages/store`). Each document carries `_v` (schema version) for lazy upgrades. No migrations.
- **Layout:** `projects/{p}/tickets/{t}/events/{e}` for tickets and history; top-level collections for questions, runs, providers, models, tiers, policies, quota readings, config changes, releases.
- **Rollups:** maintained when a run finishes (e.g., ticket/epic cost totals), or computed with Firestore aggregation queries (count/sum/avg). If ad-hoc analytics are ever needed, export to BigQuery.
- **Access:** server-only. Firestore security rules deny all client access (the Firebase web config is public); the API uses the runtime SA (`roles/datastore.user`), which bypasses rules.
- **Event-driven flow:** runs call back, GitHub sends PR/check webhooks, Andy acts via UI/MCP. A missed callback is caught by a per-run **watchdog** (one Cloud Tasks task queued at dispatch for the run's timeout). The only scheduled job is the weekly model scout. Nothing polls.
- **Backups:** daily Firestore scheduled backups with short retention, added in M1.

### Consequences

- Good: $0, no extra vendor, no database secret, no cold starts, everything in Terraform; dev uses the Firestore emulator.
- Bad: every query needs its access pattern (and any composite index) designed up front; no joins or ad-hoc SQL; aggregates beyond count/sum/avg are computed in code or kept as running totals. Swapping back to SQL later means writing a new store adapter behind the same contracts.
