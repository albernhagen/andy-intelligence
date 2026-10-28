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

## 2026-10-27 — M0: Foundations done; plan additions

- Merged: PR #1: Foundations, PR #3: gitignore Terraform plan files, PR #4: first Terraform apply, PR #5: service_url host.
- Infra applied by Andy (bootstrap 15 + 2 IAM fixes; control plane 27). CI plan shows "No changes". Deploy green. Google sign-in works at `https://control-plane-662512537397.us-central1.run.app`.
- Lessons: Identity Platform needs a quota project with local credentials; CI's `tf-plan` needed `serviceusage.serviceUsageConsumer` and `firebaserules.viewer`; Google sign-in provider is enabled by hand in Firebase (needs an OAuth client no API can create).
- Git history rewritten on all 4 repos to replace Andy's Gmail with the noreply address.
- **Decided (Andy):** adversarial PR review (ADR-0026), local quality gates (ADR-0027), GCP cost guardrails (ADR-0028). Custom domain after M5: Dev → prod releases.

## 2026-10-27 — M1.13: GCP cost guardrails built

- Branch `m1.13/gcp-cost-guardrails`. New root `infra/billing`: $25/month budget for `andy-intelligence-512400`, alerts at 50%, 90%, 100% actual and 100% forecast. Control plane: Cloud Run timeout 60s, concurrency 80; log exclusion for successful `/assets/*` and `/health` request logs; retention left at 30 days.
- **Decided (Andy, ADR-0029):** `infra/billing` plans locally only (no billing role for `tf-plan`, no Actions secret); alerts go to the billing account's default admin/user recipients; kill switch split into new slice M1.14: Cost kill switch (off, not built; depends only on M1.13, Needs-you item added after M1.2: Ticket core); new slice M1.15: Usage alerts, because GCP has no hard cap on egress, Firestore ops or log volume and budgets lag by hours.
- Verified (Google docs): no "send test alert" exists. **Decided (Andy, 2026-10-28):** instead of a $0.01 live test, "Done when" checks recipient + delivery: Andy is billing admin (default recipient) and `cloudplatform-noreply@google.com` mail reaches his inbox. Budget confirmed in the console. The live test stays optional in the billing runbook.
- Applied by Andy (2026-10-28): control plane (log exclusion added, Cloud Run timeout 300s → 60s), billing (Budget API enabled, budget created). CI plan for control plane: "No changes".
- Lessons: Cloud Run revision labels from the deploy workflow are now in `ignore_changes` (plans would strip them); the provider hides `calendar_period = "MONTH"` from plans because monthly is the API default.

## 2026-10-28 — M1.13: GCP cost guardrails merged; M1.15: Usage alerts built

- Merged: PR #7: GCP cost guardrails.
- Branch `m1.15/usage-alerts`: email channel + six Cloud Monitoring alert policies in `infra/control-plane` (Cloud Run requests and bytes sent; Firestore reads, writes, deletes; log ingestion). Monitoring API enabled. Thresholds in `usage_alert_thresholds` (billing runbook section 5).
- **Decided (Andy):** alert address is its own variable `alert_email` (gitignored tfvars + `TF_VAR_ALERT_EMAIL` Actions secret), not the allow-list; default thresholds as in the runbook.
- Verified: alerting is free until at least 2027-09-01 (then $0.35 per metric reference/month + $0.50 per million points). Firestore metric names from Firestore docs; Cloud Run and log metric names not confirmed from Google's reference pages (too large to read) — the apply validates them (Monitoring rejects unknown metric types).

## Slices: M1: First end-to-end flow: ticket → PR with Claude

Status: todo / in progress / PR open / merged. Definitions: ARCHITECTURE §12.

| Slice                                   | Size            | Depends on                                                                  | Status         |
| --------------------------------------- | --------------- | --------------------------------------------------------------------------- | -------------- |
| M1.0: Docs sync                         | S               | M0: Foundations                                                             | merged (PR #1) |
| M1.1: MCP OAuth spike                   | M               | M0: Foundations                                                             | todo           |
| M1.2: Ticket core                       | M               | M0: Foundations                                                             | todo           |
| M1.3: UI: tickets + inbox               | M               | M1.2: Ticket core                                                           | todo           |
| M1.4: MCP core tools                    | S               | M1.1: MCP OAuth spike, M1.2: Ticket core                                    | todo           |
| M1.5: GitHub App + project registration | M               | M1.2: Ticket core                                                           | todo           |
| M1.6: Claude Code executor              | L (split 6a/6b) | M1.5: GitHub App + project registration                                     | todo           |
| M1.7: Refinement                        | M               | M1.3: UI: tickets + inbox, M1.4: MCP core tools, M1.6: Claude Code executor | todo           |
| M1.8: Build + gate                      | M               | M1.7: Refinement                                                            | todo           |
| M1.9: Quota capture                     | S               | M1.6: Claude Code executor                                                  | todo           |
| M1.10: Security review automation       | M               | M0: Foundations                                                             | todo           |
| M1.11: Adversarial PR review            | M               | M1.10: Security review automation                                           | todo           |
| M1.12: Local quality gates              | S               | M0: Foundations                                                             | todo           |
| M1.13: GCP cost guardrails              | S               | M0: Foundations                                                             | merged (PR #7) |
| M1.14: Cost kill switch                 | M               | M1.13: GCP cost guardrails                                                  | todo           |
| M1.15: Usage alerts                     | S               | M1.13: GCP cost guardrails                                                  | in progress    |

**Next (parallel sessions):**

1. M1.15: Usage alerts, then M1.14: Cost kill switch.
2. M1.12: Local quality gates — every later slice benefits.
3. M1.10: Security review automation — then M1.11: Adversarial PR review.
4. M1.1: MCP OAuth spike and M1.2: Ticket core can start alongside.

**Pending decisions (Andy):**

- M1.15: Usage alerts — create the `TF_VAR_ALERT_EMAIL` secret, add `alert_email` to tfvars, review the plan, apply, run the alert test.
- M1.10: Security review automation — confirm defaults (high/critical blocks, `security-accepted` override, subscription token, weekly + milestone-end system review); create the reviewer token secret.
- First real project to onboard (open question 8); needed by M1.5: GitHub App + project registration.
- Claude plan and headless billing (open question 5); needed by M1.6: Claude Code executor.

**Blocked on Andy:** nothing.
