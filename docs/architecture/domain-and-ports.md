# andy-intelligence — Domain model and ports

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 5. Domain model (Firestore documents)

All records carry `project_id` where applicable. Documents are validated with the Zod schemas in `packages/contracts` on every read and write; tickets and their events nest under their project (`projects/{p}/tickets/{t}/events/{e}`). Ticket numbers come from a per-project counter (`counters/tickets-{p}`) in the same transaction as the ticket. Queries use equality filters only (no composite indexes); results are sorted in memory.

**Rollups** (cost per ticket/epic/model/provider) are **computed on read with Firestore aggregation queries** in v1.x — no denormalized counters. Revisit if reads get slow.

| Entity | Key fields |
|---|---|
| **Project** | name, repos, GCP dev/prod project IDs, policy overrides, budget allocation, autonomy level, enabled, `autoRefine` (default on), `autoBuild` (default off, ADR-0063), `planApproval` (default `none`, ADR-0050), `autoMerge` (`s-and-m` for new projects, ADR-0050), `executor` (`actions` or `local`, ADR-0089) |
| **Ticket** (system of record) | key (`AI-42`), title, body, acceptance criteria (the checklist; EARS for features), assumptions, type (epic/feature/chore/bug, empty at capture; ADR-0058), parent, stage, size, size reason, overrides (assignee agent/me or a harness key, resolved against the project's `defaultWorker`, ADR-0082; executor, ADR-0089; tier, model pin, autonomy, target env), needs_attention (blocked on a human), DoR status, rank, blocked_by (keys, any project), archived, out_of_scope, touches (areas or path globs; ≤ 20 × 300 chars each). No stored tier: derived from size (ADR-0062) |
| **TicketEvent** | ticket, kind (comment / stage_change / field_change / run_linked / pr_linked …), actor (`user:<uid>` for a signed-in user by auth uid, never an email (AI-19); legacy `andy`, read as the owner; agent:<run> / system; the display label is derived at read time), body/diff, timestamp — the ticket's full history |
| **Question** | ticket, text (the question line), context, choices (label, consequence), recommendation (answer, reason), options, suggested_answer, assumptions, urgency, status, answer, answered_via, run (if an agent asked), timestamps; the format fields are null or empty on questions from before AI-73 |
| **Run** | ticket, step (refine/plan/build/review/verify/scout), harness, provider, model, tier, status, started/ended, deadline, attempt + retry_of, tokens, usage (input, output, cache read and write tokens, turns, wall time; null = cost unknown), cost_usd (actual or API-equivalent estimate), quota delta (percentage points per window since the previous reading), quota snapshot, links (Action run, Jules session, PR), build plan + branch (ADR-0063), plan decision (who, when, reason) and a build's approved plan run (ADR-0050), executor identity (Actions `run_id`, Jules session id) to correlate completion signals, **outcome** (merged_clean / reworked / reverted / failed), would_auto_merge |
| **Provider** | key (claude-sub, google-sub, openrouter), billing_type (subscription / pay_per_use), credential secret ref, quota_source, reserve_pct, warn_pct, pause_pct, caps (daily/monthly USD), enabled |
| **Harness** | key (claude-code, jules, opencode, direct), runtime (actions / api / in-process), compatible providers, capabilities (agentic, skills, subagents) |
| **Model** | id, provider, price in/out, context, metadata, last_scouted |
| **Tier** | key (frontier, strong, fast, cheap), ordered **routes** of (harness, provider, model) |
| **Policy** | scope (global / project / epic / ticket), gates, autonomy, auto-merge rules, write policy, step→tier mapping |
| **QuotaReading** | provider, window (5h / weekly / daily-tasks), used_pct, resets_at, source, taken_at, confidence |
| **ConfigChange** | entity, diff, actor (andy/ui/agent/scout), reason, status (pending / applied / reverted), timestamps; each project-settings write logs one (built, M4.11) |
| **Release** | project, image digest, tickets included, notes, status |
| **CodeHostEvent** | delivery ID (document ID), project, repo, kind (pull_request / check_run / workflow_run), action, normalized PR / check / workflow fields, received_at; TTL 30 days (ADR-0041) |
| **NightLaunch** | epic, project, budget (max agent tasks, tokens, USD), stop time (≤ 16 h away), status (planned / running / stopping / ended), started/ended, end reason, story keys (ADR-0049) |

### Configuration rules
- **Global config is the ceiling; project config can only narrow** (disable providers, lower caps, raise reserves, pin tiers).
- **Compatibility enforced on save:** `claude-code` ↔ `claude-sub` + Claude models; `jules` ↔ `google-sub`; `opencode` / `direct` ↔ `openrouter` + any model.
- **Override precedence:** ticket → epic → project → global.
- Every change is a ConfigChange (audited, revertable). Agent/scout proposals are `pending` until Andy approves.

### Default global quota policy
```
claude-sub:  reserve 20% (5h and weekly windows) → warn at 70%, pause dispatch at 80%
google-sub:  reserve 20% of daily Jules tasks     → warn at 70%, pause at 80%
openrouter:  hard daily/monthly USD caps (also enforced on the OpenRouter key itself)
```
Missing or stale quota reading ⇒ treat as **unknown**: warn in UI, prefer next route, never assume headroom.

## 6. Ports (contracts) and adapters

Contracts are defined in `packages/contracts` (Zod schemas + TypeScript interfaces; OpenAPI generated for the API). **Every port has an in-memory fake and a shared contract test suite that every adapter, including the fake, must pass** (ADR-0023). CI runs suites on the fakes, and the Firestore emulator suites when the adapters or suites change (`firestore-suite.yml`, ADR-0048; locally `pnpm test:firestore`). A port's fake and suite land before its first real adapter.

| Port | Domain concepts | v1.x adapters | Later |
|---|---|---|---|
| `WorkTracker` | Project, Ticket, TicketEvent (history), Question; every write appends its event atomically | **Native (Firestore)** | Markdown in repo (ADR-0032), GitHub Issues, Linear (mirror/export) |
| `CodeHost` | Repo, PullRequest, CheckRun, Merge | **GitHub App** (`@andy/github`, ADR-0041, ADR-0043) | — |
| `CodeEventLog` | CodeHostEvent (webhook deliveries, recorded once per delivery ID) | **Firestore** (ADR-0041) | Local store (ADR-0032) |
| `CodeHostConnectionStore` | CodeHostConnection (our App: IDs + private key + webhook secret; one per control plane) | **Firestore + Secret Manager** (ADR-0043) | Local store (ADR-0032) |
| `Executor` | RunRequest, RunStatus, RunResult, CompletionSignal, Artifact links | **Claude Code via Actions**, **Jules REST API**, **OpenCode via Actions** | Cloud Run Jobs, Agent SDK, Replicas |
| `RunStore` | Run (status changes conditional on the current one: a late callback can't undo an ended run) | **Firestore** (M1.6a) | Local store (ADR-0032) |
| `ModelGateway` | Completion, Usage, Cost | OpenRouter (direct single-call steps) | LiteLLM, direct providers |
| `QuotaSource` (`QuotaStore` adds `save`) | QuotaReading | Claude `rate_limit_event` capture from run reports (§10.5), Jules task counter | Official APIs when available |
| `Notifier` | Notice, Urgency | UI (banner + Needs-you inbox); **Email** on Resend (AI-77: batched, 20 a day; `NotifyLedger`, `NotifyFlushQueue`) | Web Push + `PushSubscriptionStore` (M7: Mobile, ADR-0052), Slack |
| `Deployer` | Release, Promotion, Rollback | Cloud Deploy | — |
| `Evaluator` | Suite, Case, Score, per-case result | Agent evals (M1.17: Agent evals v1, ADR-0086); Ori Eval for scout smoke tests | Claude Code runner (`scripts/evals/evaluator.mjs`) |
| `OAuthGrantStore` | OAuthGrant (code, access token, refresh token; keyed by token hash) | **Firestore** (ADR-0039) | Local store (ADR-0032) |
| `RunnerStore` | Runner, per-run token (hashes only; ADR-0089) | **Firestore** | — |
| `NightLaunchStore` | NightLaunch; one active per project, checked atomically | **Firestore** | — |
| `Telemetry` | Trace, Span, CostEvent | OTel → Cloud Trace / Cloud Logging | BigQuery sink |

**Rule:** freeze the `Executor` contract only after **two real adapters** (Claude Code + Jules) work. Vendor terms map to domain terms (a Jules *session* is a `Run`; its *activities* are run events).
