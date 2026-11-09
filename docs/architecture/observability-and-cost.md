# andy-intelligence — Observability and cost

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 10. Observability and cost

- OTel traces/logs → Cloud Trace / Cloud Logging.
- Run records (tokens, cost, outcome, quota snapshot) in Firestore drive the UI; rollups via aggregation queries (§5).
- Paid cost from OpenRouter usage; subscription runs record **API-equivalent cost estimates** (labelled as estimates) alongside quota %.
- Transcripts are not stored; run detail links to the Action log / Jules session / PR.
### 10.1 GCP cost guardrails (ADR-0028)

| Layer | What |
|---|---|
| Caps on usage | Cloud Run max instances, timeout, concurrency; Cloud Tasks max rate/concurrency; image cleanup; log retention and exclusions |
| Budget alerts | Billing budget per GCP project (control plane starts at $25/month); email at 50%, 90%, 100% actual and 100% forecast, to the billing account's admins/users (Google default, no addresses in config) |
| Usage alerts (M1.15: Usage alerts) | Cloud Monitoring alerts within minutes on Cloud Run request rate, internet egress, Firestore operations and log volume. Budgets lag by hours and nothing in GCP caps egress, Firestore ops or log volume. |
| Kill switch (opt-in, M1.14: Cost kill switch, ADR-0036) | Budget → Pub/Sub → Eventarc → Cloud Workflow. At 150% of budget: Cloud Run to manual scaling at 0 instances, pause every Cloud Tasks queue, plus a 150% budget email. Never disables billing. `kill_switch_enabled` in `infra/billing`, off by default; Needs-you item after M1.3: UI: tickets + inbox. |

Budgets live in their own Terraform root, `infra/billing`, planned and applied locally by Andy; CI only runs fmt/validate there (ADR-0029). Current caps and manual steps: `docs/runbooks/billing.md`. Model spend caps are separate (§5).

### 10.2 Local quality gates (ADR-0027)

| When | Runs | Where |
|---|---|---|
| Agent edits a file | Prettier `--write` + ESLint `--fix`; unfixable lint errors go back to the agent | Claude Code `PostToolUse` hook: `.claude/settings.json` → `scripts/format-edited-file.mjs` |
| `git commit` | Prettier, ESLint, `terraform fmt -check`, actionlint (workflow linter) on staged files | lefthook `pre-commit` (`lefthook.yml`) |
| `git push` | `pnpm typecheck` + `pnpm test` | lefthook `pre-push` |
| PR | All of the above + build + security scans | CI (`ci.yml`; actionlint is a checksum-verified release binary) |

Hooks install with `pnpm install` (root `prepare` script; skipped when there is no `.git`, e.g. the Docker build) and use the same tools and config as CI. actionlint is skipped locally if not installed (`brew install actionlint`); CI always runs it. `--no-verify` is for emergencies only.

### 10.3 Data
- **Backups:** Firestore is the only copy of tickets, so a daily Firestore backup schedule with 7-day retention (`infra/control-plane`, M1.2: Ticket core; pennies at this size). Optional BigQuery export for ad-hoc analytics later.

### 10.4 Data evolution (ADR-0035)
The control plane's Firestore holds real data from M1.2: Ticket core on; there is no separate dev copy.
- **Additive by default:** new optional/defaulted fields need no migration.
- **Breaking change:** bump `SCHEMA_VERSION`, add a tested upgrader `_v N → N+1` applied on read (and rewritten on next write); record it in an ADR. v2: ticket model (`ticketV1toV2`: story → feature, task → chore, `needsYou` → `needsAttention`, stored tier dropped; ADR-0058, ADR-0062). v3: no Monitoring stage (`ticketV2toV3`, `ticketEventV2toV3`: `monitoring` → `done` on tickets and stage events; ADR-0069).
- **Backups** (§10.3): before a risky deploy, run a manual export (runbook); restore drill once per milestone.
- A separate control-plane dev environment comes last (§12 Later: Control plane in dev + prod); moving data then = export/import + the same upgraders.

### 10.5 Quota capture (M1.9)
Claude readings from run reports drive a gauge and banner; dispatch ignores them until M2. As built: [`runbooks/quota.md`](../runbooks/quota.md).
