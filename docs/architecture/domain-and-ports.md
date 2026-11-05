# andy-intelligence — Domain model and ports

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 5. Domain model (Firestore documents)

All records carry `project_id` where applicable. Documents are validated with the Zod schemas in `packages/contracts` on every read and write; tickets and their events nest under their project (`projects/{p}/tickets/{t}/events/{e}`). Ticket numbers come from a per-project counter (`counters/tickets-{p}`) in the same transaction as the ticket. Queries use equality filters only (no composite indexes); results are sorted in memory.

**Rollups** (cost per ticket/epic/model/provider) are **computed on read with Firestore aggregation queries** in v1.x — no denormalized counters to keep consistent. Revisit only if reads get measurably slow.

| Entity | Key fields |
|---|---|
| **Project** | name, repos, GCP dev/prod project IDs, policy overrides, budget allocation, autonomy level, enabled |
| **Ticket** (system of record) | key (e.g. `AI-42`), title, body, acceptance criteria (the checklist; EARS for features), assumptions, type (epic/feature/chore/bug, empty at capture; ADR-0058), parent, stage, size, size reason, overrides (assignee agent/me, tier, model pin, autonomy, target env), needs_attention (blocked on a human), DoR status, rank, blocked_by (ticket ids), archived, out_of_scope, touches (areas or path globs; ≤ 20 × 300 chars each). No stored tier: derived from size (ADR-0062) |
| **TicketEvent** | ticket, kind (comment / stage_change / field_change / run_linked / pr_linked …), actor (andy / agent:<run> / system), body/diff, timestamp — the ticket's full history |
| **Question** | ticket, text, options, suggested_answer, assumptions, urgency, status, answer, answered_via, run (if an agent asked), timestamps |
| **Run** | ticket, step (refine/plan/build/review/verify/scout), harness, provider, model, tier, status, started/ended, deadline, attempt + retry_of, tokens, cost_usd (actual or API-equivalent estimate), quota snapshot, links (Action run, Jules session, PR), executor identity (e.g. Actions `run_id` + workflow ref, Jules session id) used to authenticate/correlate completion signals, **outcome** (merged_clean / reworked / reverted / failed), would_auto_merge |
| **Provider** | key (claude-sub, google-sub, openrouter), billing_type (subscription / pay_per_use), credential secret ref, quota_source, reserve_pct, warn_pct, pause_pct, caps (daily/monthly USD), enabled |
| **Harness** | key (claude-code, jules, opencode, direct), runtime (actions / api / in-process), compatible providers, capabilities (agentic, skills, subagents) |
| **Model** | id, provider, price in/out, context, metadata, last_scouted |
| **Tier** | key (frontier, strong, fast, cheap), ordered **routes** of (harness, provider, model) |
| **Policy** | scope (global / project / epic / ticket), gates, autonomy, auto-merge rules, write policy, step→tier mapping |
| **QuotaReading** | provider, window (5h / weekly / daily-tasks), used_pct, resets_at, source, taken_at, confidence |
| **ConfigChange** | entity, diff, actor (andy / ui / agent / scout), reason, status (pending / applied / reverted), timestamps |
| **Release** | project, image digest, tickets included, notes, status |
| **CodeHostEvent** | delivery ID (document ID), project, repo, kind (pull_request / check_run / workflow_run), action, normalized PR / check / workflow fields, received_at; TTL 30 days (ADR-0041) |

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

Contracts are defined in `packages/contracts` (Zod schemas + TypeScript interfaces; OpenAPI generated for the API). **Every port has an in-memory fake and a shared contract test suite that every adapter, including the fake, must pass** (ADR-0023). CI runs suites on the fakes, and the Firestore emulator suites when the adapters or suites change (`firestore-suite.yml`, ADR-0048; locally `pnpm test:firestore`). A port's fake and suite land in the slice that first uses or adapts that port — before its first real adapter.

| Port | Domain concepts | v1.x adapters | Later |
|---|---|---|---|
| `WorkTracker` | Project, Ticket, TicketEvent (history), Question; every write appends its event atomically | **Native (Firestore)** | Markdown in repo (ADR-0032), GitHub Issues, Linear (mirror/export) |
| `CodeHost` | Repo, PullRequest, CheckRun, Merge (v1: `getRepo`, `listInstalledRepos`, `issueRepoToken`; `dispatchWorkflow`, `getWorkflowRun`, `cancelWorkflowRun` from M1.6a; PR/check reads come later) | **GitHub App** (`@andy/github`, ADR-0041, ADR-0043) | — |
| `CodeEventLog` | CodeHostEvent (webhook deliveries, recorded once per delivery ID) | **Firestore** (ADR-0041) | Local store (ADR-0032) |
| `CodeHostConnectionStore` | CodeHostConnection (our App: IDs + private key + webhook secret; one per control plane) | **Firestore + Secret Manager** (ADR-0043) | Local store (ADR-0032) |
| `Executor` | RunRequest, RunStatus, RunResult, CompletionSignal, Artifact links | **Claude Code via Actions**, **Jules REST API**, **OpenCode via Actions** | Cloud Run Jobs, Agent SDK, Replicas |
| `RunStore` | Run (status changes conditional on the current status, so a late callback can't undo a finished run) | **Firestore** (M1.6a) | Local store (ADR-0032) |
| `ModelGateway` | Completion, Usage, Cost | OpenRouter (direct single-call steps) | LiteLLM, direct providers |
| `QuotaSource` | QuotaReading | Claude statusline/`rate_limits` capture from runs, Jules task counter | Official APIs when available |
| `Notifier` | Notice, Urgency | UI (banner + Needs-you inbox) | Email (pending S slice), Web Push + `PushSubscriptionStore` (M7: Mobile, ADR-0052), Slack |
| `Deployer` | Release, Promotion, Rollback | Cloud Deploy | — |
| `Evaluator` | Suite, Case, Score | Agent evals (M1.17: Agent evals v1: procedure/prompt regression suite, tool chosen in the slice); Ori Eval for scout smoke tests | promptfoo, Inspect AI |
| `OAuthGrantStore` | OAuthGrant (code, access token, refresh token; keyed by token hash) | **Firestore** (ADR-0039) | Local store (ADR-0032) |
| `Telemetry` | Trace, Span, CostEvent | OTel → Cloud Trace / Cloud Logging | BigQuery sink |

**Rule:** freeze the `Executor` contract only after **two real adapters** (Claude Code + Jules) work. Vendor terms map to domain terms (a Jules *session* is a `Run`; its *activities* are run events).
