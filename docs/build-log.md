# Build log

Temporary progress log until andy-intelligence can track its own work (then migrated to tickets).

## 2026-10-21 — M0: Foundations: repo, sign-in, GCP infra started

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

## 2026-10-22 — PR #1: Foundations opened; M1.0: Docs sync

- PR #1: Foundations opened: `m0/foundations` → `main`. Runbook steps 0–4 still pending.
- M1.0: Docs sync folded into PR #1: Foundations to avoid a stacked PR; PR #2: Docs sync closed: ARCHITECTURE revision `2026-10-22a`; ADRs 0018–0023; `AGENTS.md` (+ `CLAUDE.md` symlink); PR template with docs checklist; build prompt moved to slices.
- **Decided (Andy):** ADR-0012 rejected — every port gets a fake + contract suite, written in the slice that first uses the port (ADR-0023). Docs ship with the change (ADR-0022). M1: First end-to-end flow split into slices (ADR-0021).
- **Decided (Andy):** no stacked PRs — slices branch from latest `main` (ADR-0021). Terraform pinned to 1.16.7 via `.terraform-version`, managed with tenv (ADR-0024). Docs written short and plain (ADR-0022).

## 2026-10-23 — Security review designed

- **Decided (Andy):** security is checked by agents on every PR and across the system over time (ADR-0025, ARCHITECTURE §9.1). New slice M1.10: Security review automation.
- **Defaults (Andy to confirm):** high/critical agent findings block merge, overridable with the `security-accepted` label; reviewer runs on the Claude subscription token; system review weekly (if anything merged) + end of each milestone.
- **Seed risks for the threat model:** CI's `tf-plan` identity has basic Viewer (likely reads Firestore data and logs) and is usable from any same-repo branch; repo secrets readable by same-repo branch workflows; public Cloud Run URL (cost abuse); Firebase web API key is public by design.

## Slices: M1: First end-to-end flow: ticket → PR with Claude

Status: todo / in progress / PR open / merged. Definitions: ARCHITECTURE §12.

| Slice                                   | Size            | Depends on                                                                  | Status                       |
| --------------------------------------- | --------------- | --------------------------------------------------------------------------- | ---------------------------- |
| M1.0: Docs sync                         | S               | M0: Foundations                                                             | PR open (PR #1: Foundations) |
| M1.1: MCP OAuth spike                   | M               | M0: Foundations                                                             | todo                         |
| M1.2: Ticket core                       | M               | M0: Foundations                                                             | todo                         |
| M1.3: UI: tickets + inbox               | M               | M1.2: Ticket core                                                           | todo                         |
| M1.4: MCP core tools                    | S               | M1.1: MCP OAuth spike, M1.2: Ticket core                                    | todo                         |
| M1.5: GitHub App + project registration | M               | M1.2: Ticket core                                                           | todo                         |
| M1.6: Claude Code executor              | L (split 6a/6b) | M1.5: GitHub App + project registration                                     | todo                         |
| M1.7: Refinement                        | M               | M1.3: UI: tickets + inbox, M1.4: MCP core tools, M1.6: Claude Code executor | todo                         |
| M1.8: Build + gate                      | M               | M1.7: Refinement                                                            | todo                         |
| M1.9: Quota capture                     | S               | M1.6: Claude Code executor                                                  | todo                         |
| M1.10: Security review automation       | M               | M0: Foundations                                                             | todo                         |

Next, in parallel, once M0: Foundations merges:

- M1.10: Security review automation (first, so later slices get reviewed)
- M1.1: MCP OAuth spike
- M1.2: Ticket core

**Pending decisions (Andy):**

- Confirm the M1.10: Security review automation defaults above; create the reviewer token secret when that slice starts.

- First real project to onboard (open question 8); needed by M1.5: GitHub App + project registration.
- Claude plan and headless billing (open question 5); needed by M1.6: Claude Code executor.
- MCP OAuth mechanism: answered by M1.1: MCP OAuth spike.

**Blocked on Andy:**

- M0: Foundations: runbook steps 0–4 (`docs/runbooks/m0-setup.md`), first `terraform plan` review, merge PR #1: Foundations.
