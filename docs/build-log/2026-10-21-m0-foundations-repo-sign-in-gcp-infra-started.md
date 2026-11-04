# 2026-10-21 — M0: Foundations: repo, sign-in, GCP infra started

**Decided (Andy):** GitHub org `albernhagen-org` (superseded: personal public repo `albernhagen/andy-intelligence`, ADR-0003); GCP project `andy-intelligence-512400`; Neon free tier; `us-central1`; default run.app URL; standard TS stack. See ADR-0003, 0007, 0008, 0009.

**Done (branch `m0/foundations`):**

- Monorepo scaffold, CI (lint, typecheck, test, build, terraform fmt/validate).
- `@andy/contracts`: §5 entities as Zod, ports, fakes + contract suites for WorkTracker / Executor / QuotaSource (8 tests).
- `@andy/store`: Firestore client and Zod-validated converters (4 tests). (Replaced the earlier Drizzle/Postgres package before anything was deployed.)
- `@andy/api`: Hono + OpenAPI, `/health`, `/config.json`, `/api/me` behind Firebase token + allow-list (5 tests); serves the SPA.
- `@andy/web`: React/Vite/Tailwind/shadcn shell with Google sign-in.
- Dockerfile; deploy and terraform-plan workflows (WIF, no keys).
- Terraform: `infra/bootstrap`, `infra/control-plane` (google provider 8.8). **Not validated locally** — the workspace can't reach the Terraform registry; CI runs `terraform validate`.
- ADRs 0001–0017; runbook `docs/runbooks/m0-setup.md`.

**Verified locally:** tests, typecheck, lint, builds, and a smoke run of the bundled server (`/health` 200, `/api/me` 401, SPA fallback 200).

**Decided (Andy, later 2026-10-21):** repo is public (ADR-0015: secret hygiene, TruffleHog + GitHub push protection); CI plans / local applies and public service with app-level auth confirmed (ADR-0010, 0011). Neon reconfirmed after checking Cloud SQL has no free tier (~$10/mo minimum).

**Decided (Andy, 2026-10-21 evening):** repo transferred to personal account `albernhagen/andy-intelligence` (ADR-0003). Work tracking moves into the app: Postgres tickets + in-app story board + MCP; GitHub only for code (ADR-0016, supersedes 0004). ARCHITECTURE.md updated (§1–4, 5, 6, 7, 8, 9, 10, 11, 12, 13). DB schema and contracts updated before any migration was applied (tickets as system of record, `ticket_events`, `ticket_dependencies`, project ticket keys). Stay on Neon (Supabase free tier pauses after a week idle and duplicates Firebase/GCP features).

**Decided (Andy, 2026-10-21 late):** Firestore replaces Neon/Postgres (ADR-0017, supersedes 0008 and 0013). Event-driven flow: per-run Cloud Tasks watchdog instead of a polling reconciler; weekly scout is the only scheduled job. Cloud SQL priced at ≈$9.50/mo and rejected.
