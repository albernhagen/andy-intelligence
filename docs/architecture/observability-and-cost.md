# andy-intelligence — Observability and cost

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 10. Observability and cost

- OTel traces/logs → Cloud Trace / Cloud Logging.
- Run records (tokens, cost, outcome, quota snapshot) in Firestore drive the UI; rollups via aggregation queries (§5).
- Paid cost from OpenRouter usage; subscription runs record **API-equivalent cost estimates** (labelled as estimates) alongside quota %.
- Cost per run and ticket (AI-67): `packages/domain/src/cost.ts`; a run without usage is unknown, counted but not priced.
- Dashboards (AI-102): `domain/src/dashboard.ts`; lead time: Done from its cycle's first Ready.
- DORA (M6, ADR-0114): from Deployment records the release workflow reports, prod only, for any deploy kind (`domain/src/dora.ts`).
- Transcripts are not stored; run detail links to the Action log / Jules session / PR.
### 10.1 GCP cost guardrails (ADR-0028)

| Layer | What |
|---|---|
| Caps on usage | Cloud Run max instances, timeout, concurrency; Cloud Tasks max rate/concurrency; image cleanup; log retention and exclusions |
| Budget alerts | Billing budget per GCP project (control plane starts at $25/month); email at 50%, 90%, 100% actual and 100% forecast, to the billing account's admins/users (Google default, no addresses in config) |
| Usage alerts (M1.15: Usage alerts) | Cloud Monitoring alerts within minutes on Cloud Run request rate, internet egress, Firestore operations and log volume. Budgets lag by hours and nothing in GCP caps egress, Firestore ops or log volume. |
| Prod alerts (AI-209: M6.19) | `cloud-run` prod services: uptime check on `/health` (every 5 min, 3 regions) and a 5xx alert, to `alert_email`; ~$0.20/month per service. Alert → ticket and error budgets: Later. |
| Kill switch (opt-in, M1.14: Cost kill switch, ADR-0036) | Budget → Pub/Sub → Eventarc → Cloud Workflow. At 150% of budget: Cloud Run to manual scaling at 0 instances, pause every Cloud Tasks queue, plus a 150% budget email. Never disables billing. `kill_switch_enabled` in `infra/billing`, off by default; Needs-you item after M1.3: UI: tickets + inbox. |

Budgets live in their own Terraform root, `infra/billing`, planned and applied locally by Andy; CI only runs fmt/validate there (ADR-0029). Current caps and manual steps: `docs/runbooks/billing.md`. Model spend caps are separate: [`spend-and-caps.md`](spend-and-caps.md) (ADR-0129).

### 10.2 Local quality gates (ADR-0027)

| When | Runs | Where |
|---|---|---|
| Agent edits a file | Prettier `--write` + ESLint `--fix`; unfixable lint errors go back to the agent | Claude Code `PostToolUse` hook: `.claude/settings.json` → `scripts/format-edited-file.mjs` |
| `git commit` | Prettier, ESLint, `terraform fmt -check`, actionlint (workflow linter) on staged files | lefthook `pre-commit` (`lefthook.yml`) |
| `git push` | `pnpm typecheck` + affected tests (ADR-0113) | lefthook `pre-push` |
| PR | All of the above + build + security scans | CI (`ci.yml`; actionlint is a checksum-verified release binary) |

Hooks install with `pnpm install` (root `prepare` script; skipped when there is no `.git`, e.g. the Docker build) and use the same tools and config as CI. actionlint is skipped locally if not installed; CI always runs it. `--no-verify` is for emergencies only.

### 10.3 Data
- **Backups:** Firestore is the only copy of tickets, so a daily Firestore backup schedule with 7-day retention (`infra/control-plane`, M1.2: Ticket core; pennies at this size). Optional BigQuery export for ad-hoc analytics later.

### 10.4 Data evolution (ADR-0035)
Detail: [`data-evolution.md`](data-evolution.md).

### 10.5 Quota capture (M1.9)
Claude readings from run reports drive a gauge and banner; dispatch ignores them until M2. As built: [`runbooks/quota.md`](../runbooks/quota.md).
