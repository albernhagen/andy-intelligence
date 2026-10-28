---
title: andy-intelligence — Architecture & Vision
status: accepted (v1.x scope)
owner: Andy
last_updated: 2026-10-23
revision: 2026-10-23a (agentic security review)
---

# andy-intelligence — Architecture & Vision

A personal, single-tenant **control plane for agentic software development** across many side projects. It turns ideas into refined tickets, routes work to the right agent/model under cost and quota controls, ships to dev with self-verification, gives Andy a one-click release to prod, and keeps him informed through a single "Needs you" surface.

Enterprise-shaped (durable state, policy, gates, least privilege, audit, contract-first) but sized for one person.

---

## 1. Goals and non-goals

### Goals (v1.x)
1. **Ideate with system context.** Design new features with knowledge of the current architecture and shipped features; outputs become markdown in the project repo.
2. **Ticketing from anywhere.** Create and refine work in the UI or conversationally from any MCP-capable AI tool (Claude desktop first).
3. **Mandatory refinement.** Every story gets a refinement pass in which agents ask Andy targeted questions before work starts.
4. **Autonomous end-to-end by default**, with overrides at global → project → epic → ticket level.
5. **Cost and quota control.** Visibility into subscription usage and pay-per-use spend; reserves on subscriptions (Andy uses them outside this system); hard caps on paid spend; warnings in the UI.
6. **Model tiers.** Each pipeline step uses a tier, not a hardcoded model; tiers map to ordered routes of (harness, provider, model); a weekly scout proposes tier updates.
7. **Multi-project, single tenant.** Andy sees everything; each project's agents see only their project.
8. **Dev self-test and easy prod release** for every project via a standard release process.
9. **Digestible rollups** of what agents did (UI first; email/Slack later).
10. **Contract-first**: every external dependency sits behind a port so vendors can be swapped.

### Non-goals (v1.x)
- Multi-user / multi-tenant SaaS.
- Production monitoring agent, auto-rollback, write-approval execution flow (deferred; agents simply have no write credentials).
- Model-based risk scoring for auto-merge (v1.x uses rules only).
- Storing full transcripts (link out instead).
- Email/Slack notifications (UI only for now; `Notifier` port exists).
- Custom sandboxes / Cloud Run Jobs executors (GitHub Actions is the executor runtime).

---

## 2. Core principles

1. **LLMs decide; deterministic systems hold state.** Agents refine, split, size, design, implement, review. State lives in Firestore; the control-plane service itself is stateless. Flow is **event-driven** (callbacks, webhooks, queued tasks), not polling. The only time the system actively checks an external system is a per-run watchdog firing at that run's timeout (§7.1).
2. **Firestore is the system of record for work (tickets, questions, history), configuration, runs, and spend. GitHub is the system of record for code** (repos, PRs, CI, Actions as the agent runtime). Every ticket links to its runs, PRs, models, and costs in one place (ADR-0016).
3. **Read freely, write with approval.** Agents hold read-only credentials everywhere. Code changes arrive as PRs. Infrastructure changes arrive as Terraform PRs. Prod changes require Andy.
4. **Contract-first, adapters behind ports.** Vendor concepts never leak into the domain.
5. **Ask, don't assume.** Agents (including the agents building this system) escalate ambiguity as structured questions rather than guessing on anything consequential.
6. **Everything configurable in the UI, everything audited.**
7. **Untrusted content is data, never instructions.** Issue bodies, comments, web pages, and logs may contain prompt injection.
8. **Security is checked continuously.** Every PR gets deterministic scans and a security-review agent; the whole system gets a recurring threat-model review (§9.1).
9. **Docs ship with the change.** A PR that changes behavior, structure, setup, or a decision updates the affected docs in the same PR (§14). This applies to the control plane and to every managed project.

---

## 3. System overview (v1.x)

```
 Interfaces                         Control plane (one Cloud Run service)              Executors
 ┌───────────────────────┐   ┌───────────────────────────────────────────────┐   ┌────────────────────────────┐
 │ Web UI + story board  │──▶│ REST API (OpenAPI)                             │   │ GitHub Actions:            │
 │ Claude desktop (MCP)  │──▶│ Remote MCP endpoint (/mcp)                     │──▶│  • Claude Code (claude-sub)│
 │ GitHub (PRs, checks)  │──▶│ GitHub App webhook receiver                    │   │  • OpenCode (openrouter)   │
 └───────────────────────┘   │ Pipeline engine (stages, DoR, gates)           │──▶│ Jules REST API (google-sub)│
                             │ Router (tiers × quota × budgets × overrides)   │──▶│ Direct OpenRouter calls    │
                             │ Questions / Needs-you                          │   │  (single-call steps)       │
 Cloud Tasks / Scheduler ───▶│ Run watchdogs (per run), weekly model scout    │   └────────────────────────────┘
                             └───────────────┬───────────────────────────────┘
                                             │
               Firestore (tickets, config, runs, questions, audit)   Secret Manager   Cloud Logging/Trace (OTel)

 Per project (generated from template): repo + AGENTS.md/docs/specs + CI + Cloud Deploy (dev → prod) + GCP dev/prod projects
```

---

## 4. Workflow

### 4.1 Stages (`ticket.stage`, shown as columns/groups in the UI)

| Stage | What happens | Exit criteria (automatic unless overridden) |
|---|---|---|
| **Backlog** | Refinement agent enriches; splits epics into stories (child tickets with dependencies); sizes; assigns tier; **asks Andy questions** | **Definition of Ready (DoR)** met |
| **Ready** | Waits for dependencies, agent assignee, quota/budget availability | Dispatcher starts a run |
| **In progress** | Executor runs (per tier route). One automatic retry, then flags Needs-you | PR opened with structured run summary |
| **Ready for review** | Rule-based gate decides auto-merge vs. Andy | Merged |
| **Monitoring** | CI deploys to dev; verification (smoke/e2e + verification agent) runs; Andy promotes to prod when ready | Dev verification passed (and, if released, prod deploy succeeded) |
| **Done** | Summary included in rollups | — |

**Needs-you is a flag, not a stage.** Flagged items stay in their stage and appear in the Needs-you inbox (UI + MCP).

### 4.2 Definition of Ready (story)
- Problem/intent stated; acceptance criteria in **EARS** form ("WHEN … THE SYSTEM SHALL …").
- Size tagged S/M/L with one-line justification (rubric in `docs/agent/size-rubric.md`).
- Dependencies declared (ticket "blocked by" links).
- Tier assigned (default from policy, or override).
- **No open questions.** Assumptions listed explicitly.
- Per-project policy may allow "proceed on documented assumptions" for S tasks only; default is **require Andy's answers**.

### 4.3 Refinement and questions
- Every story receives a refinement pass: the agent drafts the story, lists assumptions, and asks **1–5 targeted questions** (highest-impact ambiguities first; multiple choice with a suggested default where possible).
- Questions are **structured records** (ticket, text, options, suggested answer, urgency, status, answer, answered_via).
- Andy answers from the UI or MCP. A `/refine` skill in Claude desktop pulls all pending questions across projects for a batched conversational session and writes answers back.
- Answering re-triggers the DoR check.

### 4.4 Epics
- Ticket types (Epic / Story / Task / Bug) + **child tickets** (`parent_id`).
- Epic refinement produces stories with `depends_on`. Stories are vertical slices, independently mergeable behind feature flags; merge to `main`, no long-lived epic branches.
- **Just-in-time re-planning:** when a story unblocks, a short plan pass re-reads the current codebase before execution.
- Epic status, cost, and progress roll up from children. Overrides on an epic cascade to its stories.

### 4.5 Review gate (v1.x: rules only)
- **Hard vetoes → Andy reviews:** protected paths (CODEOWNERS: auth, payments, migrations, infra), dependency changes, CI not green, new behavior without new tests, diff > N lines, any agent-raised concern.
- **Otherwise:** S tasks may auto-merge if project policy allows; M/L always go to Andy in v1.x.
- From M1: First end-to-end flow onward, **record what the gate *would* have decided** to build the dataset for later model-based scoring.
- Cross-model review: a reviewer from a different vendor than the implementer comments on every PR.
- Security review on every PR (§9.1). A high/critical security finding is a hard veto unless Andy marks it `security-accepted`.

### 4.6 Environments and release
- Per project: separate GCP projects `<app>-dev` and `<app>-prod`.
- **Build once, promote the same image digest** via **Cloud Deploy** (dev → prod, approval required for prod, one-click rollback).
- On merge: deploy to dev → run smoke/e2e (Playwright + API tests) → verification agent summarizes results and logs onto the ticket.
- **Release:** "Promote to prod" from UI or MCP → Cloud Deploy approval → deploy. Release notes generated from tickets in the release.
- Agent write policy: dev writes allowed by project policy; prod is read-only for agents.

---

## 5. Domain model (Firestore documents)

All records carry `project_id` where applicable. Documents are validated with the Zod schemas in `packages/contracts` on every read and write; tickets and their events nest under their project (`projects/{p}/tickets/{t}/events/{e}`).

**Rollups** (cost per ticket/epic/model/provider) are **computed on read with Firestore aggregation queries** in v1.x — no denormalized counters to keep consistent. Revisit only if reads get measurably slow.

| Entity | Key fields |
|---|---|
| **Project** | name, repos, GCP dev/prod project IDs, policy overrides, budget allocation, autonomy level, enabled |
| **Ticket** (system of record) | key (e.g. `AI-42`), title, body, acceptance criteria (EARS), assumptions, type (epic/story/task/bug), parent, stage, size, tier, overrides (assignee agent/me, tier, model pin, autonomy, target env), needs_you, DoR status, rank, blocked_by (ticket ids) |
| **TicketEvent** | ticket, kind (comment / stage_change / field_change / run_linked / pr_linked …), actor (andy / agent:<run> / system), body/diff, timestamp — the ticket's full history |
| **Question** | ticket, text, options, suggested_answer, assumptions, urgency, status, answer, answered_via, timestamps |
| **Run** | ticket, step (refine/plan/build/review/verify/scout), harness, provider, model, tier, status, started/ended, deadline, tokens, cost_usd (actual or API-equivalent estimate), quota snapshot, links (Action run, Jules session, PR), executor identity (e.g. Actions `run_id` + workflow ref, Jules session id) used to authenticate/correlate completion signals, **outcome** (merged_clean / reworked / reverted / failed), would_auto_merge |
| **Provider** | key (claude-sub, google-sub, openrouter), billing_type (subscription / pay_per_use), credential secret ref, quota_source, reserve_pct, warn_pct, pause_pct, caps (daily/monthly USD), enabled |
| **Harness** | key (claude-code, jules, opencode, direct), runtime (actions / api / in-process), compatible providers, capabilities (agentic, skills, subagents) |
| **Model** | id, provider, price in/out, context, metadata, last_scouted |
| **Tier** | key (frontier, strong, fast, cheap), ordered **routes** of (harness, provider, model) |
| **Policy** | scope (global / project / epic / ticket), gates, autonomy, auto-merge rules, write policy, step→tier mapping |
| **QuotaReading** | provider, window (5h / weekly / daily-tasks), used_pct, resets_at, source, taken_at, confidence |
| **ConfigChange** | entity, diff, actor (andy / ui / agent / scout), reason, status (pending / applied / reverted), timestamps |
| **Release** | project, image digest, tickets included, notes, status |

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

---

## 6. Ports (contracts) and adapters

Contracts are defined in `packages/contracts` (Zod schemas + TypeScript interfaces; OpenAPI generated for the API). **Every port has an in-memory fake and a shared contract test suite that every adapter, including the fake, must pass** (ADR-0012 rejected a narrower scope; see ADR-0023). A port's fake and suite land in the slice that first uses or adapts that port — before its first real adapter.

| Port | Domain concepts | v1.x adapters | Later |
|---|---|---|---|
| `WorkTracker` | Ticket, Stage, Field, Comment, Child, Dependency | **Native (Firestore)** | GitHub Issues, Linear (mirror/export) |
| `CodeHost` | Repo, PullRequest, CheckRun, Merge | GitHub App (REST + webhooks) | — |
| `Executor` | RunRequest, RunStatus, RunResult, CompletionSignal, Artifact links | **Claude Code via Actions**, **Jules REST API**, **OpenCode via Actions** | Cloud Run Jobs, Agent SDK, Replicas |
| `ModelGateway` | Completion, Usage, Cost | OpenRouter (direct single-call steps) | LiteLLM, direct providers |
| `QuotaSource` | QuotaReading | Claude statusline/`rate_limits` capture from runs, Jules task counter | Official APIs when available |
| `Notifier` | Notice, Urgency | UI (banner + Needs-you inbox) | Email, Slack, push |
| `Deployer` | Release, Promotion, Rollback | Cloud Deploy | — |
| `Evaluator` | Suite, Case, Score | (stub) Ori Eval for scout smoke tests | promptfoo, Inspect AI |
| `Telemetry` | Trace, Span, CostEvent | OTel → Cloud Trace / Cloud Logging | BigQuery sink |

**Rule:** freeze the `Executor` contract only after **two real adapters** (Claude Code + Jules) work. Vendor terms map to domain terms (a Jules *session* is a `Run`; its *activities* are run events).

---

## 7. Components

### 7.1 Control plane service (Cloud Run)
- **API** — REST, OpenAPI-documented, the single entry point for UI and MCP.
- **MCP server** — remote, Streamable HTTP at `/mcp`. Tools generated from API contracts. v1.x tools: `list_projects`, `create_ticket`, `get_ticket`, `refine` (start refinement), `list_needs_me`, `answer_question`, `set_override`, `start`, `status`, `quota`, `promote_release`, `get_config`, `propose_config_change`.
- **Webhook receiver** — GitHub App webhooks for PRs, check runs, and workflow runs (HMAC-verified, idempotent by delivery ID).
- **Run completion signals** (event-driven, per executor):
  | Executor | Primary signal | Backup |
  |---|---|---|
  | Claude Code / OpenCode (Actions) | API callback from the workflow (§9 agent callback auth) | `workflow_run` completed webhook |
  | Jules | `pull_request` opened webhook on the PR Jules creates (correlated to the Run by branch/PR body) | Watchdog reads session `activities` once at deadline |
  | Direct | In-process; no signal needed | — |
- **Run watchdog** — when a run is dispatched, a Cloud Tasks task is queued for its deadline. If no completion signal has arrived by then, the watchdog checks the executor/PR directly **once**, then heals the record or flags Needs-you. No periodic polling; nothing runs when no work is in flight.
- **Pipeline engine** — stage transitions, DoR checks, gate rules, dependency release, retry policy.
- **Router** — picks the route for a step: overrides → tier routes in order → skip providers paused by quota/budget → fall back or queue.
- **Scheduled jobs** (Cloud Scheduler → authenticated endpoint): weekly **model scout**; weekly **system security review** per project when something merged since the last one (§9.1). Quota readings are captured from run results, not sampled.
- **UI** — static SPA served by the same service.

### 7.2 Executors
- **Claude Code**: reusable GitHub Actions workflow using `anthropics/claude-code-action` with `CLAUDE_CODE_OAUTH_TOKEN`; dispatched via `workflow_dispatch` with the run ID (non-secret) as input; reports back via an API callback authenticated with the workflow's GitHub OIDC token. Uses the platform skills plugin and subagents.
- **Ticket context for agents** (all executors): the dispatch request carries the ticket snapshot (title, body, acceptance criteria, assumptions, answered questions). In M1: First end-to-end flow, that snapshot plus the callback (report/comment/question on its own ticket) is all an agent gets. From M4: Second project + epics + story board, agents that need more call the API/MCP read-only, scoped to that ticket's project, authenticated the same way (OIDC for Actions runs; a per-run token minted at dispatch for non-Actions executors).
- **OpenCode**: reusable Actions workflow running OpenCode with a per-project OpenRouter key; default harness for non-Claude models. Same callback auth as Claude Code.
- **Jules**: REST API (`sessions`, `activities`, `approvePlan`, `sendMessage`), configured to open a PR on completion. Completion is detected via the PR webhook (§7.1); `activities` are read on demand (watchdog, run detail view), not polled.
- **Direct**: in-process OpenRouter calls for single-call steps (sizing, question drafting where non-agentic, digests, scout analysis).

### 7.3 Skills (platform plugin, versioned)
`/ideate`, `/refine`, `/spec`, `/plan-story`, `/build`, `/review`, `/security-review` (per PR), `/threat-model` (system review), `/verify`, `/scout-models`, (later `/digest`).
Substance lives in shared procedure docs (`docs/agent/*.md`) so non-Claude harnesses use the same knowledge; Claude skills/subagents are thin wrappers. Subagents with least-privilege tools: researcher (read-only), designer, critic (read-only), security reviewer (read-only, no shell or network), test-writer, implementer, verifier (run, no edit).

### 7.4 Model scout (weekly)
1. Pull OpenRouter models API (pricing, context, availability).
2. Research recent releases and coding leaderboards (web).
3. Optionally run Ori Eval smoke tests on new candidates.
4. Read Run outcomes per tier/model.
5. Emit a **pending ConfigChange** for tiers with rationale → Needs-you inbox.

### 7.5 UI (React + Vite + shadcn/ui + Tailwind, TanStack Router/Query/Table, dnd-kit, shadcn charts)
v1.x screens:
- **Needs-you inbox** (questions, gate reviews, pending config changes, quota warnings) — home screen.
- **Quota & spend** (per provider gauges with reset times; paid spend vs caps; persistent banner on warn/pause).
- **Projects** (list, config, policy overrides).
- **Tickets** — M1: list view grouped by stage, ticket detail with history and linked runs/PRs/cost, create/edit. M4: drag-and-drop story board (dnd-kit), epic grouping, overrides editing.
- **Run detail** — M1: run summary inside ticket detail. M4: dedicated screen (metadata, cost, outcome, links out to Action log / Jules session / PR).
- **Config** (providers, harnesses, models, tiers, policies; audit log with revert; pending approvals).
- **Releases** (dev status, promote to prod, rollback).
API client generated from OpenAPI.

---

## 8. Project template (what each managed project gets)

```
AGENTS.md                         # rules for all agents (CLAUDE.md symlink)
docs/roadmap.md
docs/features.md                  # living catalog of shipped features (updated on merge)
docs/architecture/overview.md     # current HLD; C4 L1–L2 in Mermaid
docs/architecture/adr/NNNN-*.md   # MADR, immutable
docs/agent/*.md                   # shared procedures: size-rubric, build, review, escalation, security
docs/security/threat-model.md     # living threat model + open risks (§9.1)
specs/NNN-name/{design.md, tech-design.md, tasks.md, stories/*.md, mockups/}
.github/workflows/                # thin callers → platform reusable workflows; CI checks
CODEOWNERS                        # always-gated paths
infra/                            # Terraform: dev/prod Cloud Run, Cloud Deploy pipeline, read-only agent SAs
```
**Required CI checks** on `main`: tests, lint, typecheck, protected-path check, secret scan, security scans and security-review agent (§9.1), "PR references a ticket" (ticket key in branch name or PR body, verified against the control-plane API). These enforce rules for every agent regardless of harness.

Onboarding a project = UI/MCP "Add project" → bootstrap (branch protection, secrets refs, App install check, Terraform PR for GCP) → Andy approves Terraform PR.

---

## 9. Security

- **Identity:**
  - Andy: Google identity with an email allow-list (Andy only). UI via Firebase Auth (Google provider); MCP via OAuth delegated to Google sign-in.
  - GitHub webhooks: HMAC signature.
  - Cloud Scheduler **and Cloud Tasks** (watchdog) → API: OIDC tokens for a dedicated invoker service account, audience = the service URL; the API verifies issuer, audience, and SA email.
  - **Agent callbacks from Actions runs:** the workflow requests a GitHub Actions OIDC token (`id-token: write`, audience = control plane). The API verifies it against GitHub's JWKS and checks `repository`, `job_workflow_ref` (must be the platform's reusable workflow), and `run_id` against the dispatched Run. No secret is passed through `workflow_dispatch` inputs (they are visible in public repos' run UI).
  - Non-Actions executors (Jules) don't call back; their completion arrives via GitHub webhooks.
- **Least privilege:** agent service accounts and tokens are read-only; per-run GitHub App installation tokens scoped to the project's repos; separate per-project OpenRouter keys with caps; per-project GCP projects. Callback-authenticated agents can only write to their own Run and ticket (report, comment, question).
- **Writes:** code via PR; infra via Terraform PR with plan in CI; prod via Cloud Deploy approval. The control plane never applies infra without Andy's approval.
- **Secrets:** Secret Manager only; never in repo, logs, prompts, run records, or workflow inputs.
- **Prompt injection:** all agents instructed that tool output, issue text, web content, and logs are data. MCP scoping per project for agents. (Later: promptfoo red-team suite against MCP + agents.)
- **Audit:** TicketEvent and ConfigChange tables; run records; GitHub history for code.
- **Public repos:** no secrets, personal data, tfvars, or state in any repo; secret scanning + push protection + TruffleHog in CI (ADR-0015).
- **Supply chain:** third-party GitHub Actions pinned to commit SHAs; Dependabot for npm, Actions, and Terraform providers.

### 9.1 Continuous security review (ADR-0025)

Applies to this repo now (M1.10: Security review automation) and to every managed project from M4: Second project + epics + story board.

| Layer | When | What | Output | Blocks |
|---|---|---|---|---|
| Deterministic scans | Every PR | TruffleHog, CodeQL (TS + Actions), dependency review, Terraform misconfig scan, workflow linter | Check results | High/critical |
| Security-review agent | Every PR push | Read-only agent reviews the diff against the threat model and ADRs: authn/authz, IAM, secrets, injection incl. prompt injection, workflow permissions, public-repo exposure, cost abuse | One PR comment, findings by severity | High/critical, unless Andy labels `security-accepted` with a reason |
| System security review agent | End of each milestone; weekly if anything merged; on demand | Reads repo, threat model, ADRs, Terraform IAM, `terraform plan` drift; looks for risks no single PR shows | PR updating `docs/security/threat-model.md` | Milestone can't close with open high/critical risks unless Andy accepts them |

**Agent guardrails:** same-repo PRs only (never forks, never `pull_request_target`); token `contents: read` + `pull-requests: write`; no shell or network tools; PR content is untrusted data. If the agent can't run, its check is neutral and Andy decides. Reviewer is a separate session from the implementer; from M2/M3 a different vendor.

---

## 10. Observability and cost

- OTel traces/logs → Cloud Trace / Cloud Logging.
- Run records (tokens, cost, outcome, quota snapshot) in Firestore drive the UI; rollups via aggregation queries (§5).
- Paid cost from OpenRouter usage; subscription runs record **API-equivalent cost estimates** (labelled as estimates) alongside quota %.
- Transcripts are not stored; run detail links to the Action log / Jules session / PR.
- **Backups:** Firestore is the only copy of tickets, so daily Firestore scheduled backups (short retention; pennies at this size) ship in M1: First end-to-end flow. Optional BigQuery export for ad-hoc analytics later.

---

## 11. Technology choices

| Concern | Choice |
|---|---|
| Language / repo | TypeScript, pnpm workspaces monorepo |
| API | Node HTTP framework with Zod-based OpenAPI generation (builder to propose; e.g., Hono + zod-openapi) |
| MCP | Official MCP TypeScript SDK, Streamable HTTP, OAuth |
| DB | Firestore (Native mode, default database, us-central1; free tier) with Zod-validated converters; no migrations (ADR-0017) |
| UI | React, Vite, shadcn/ui, Tailwind, TanStack Router/Query/Table, dnd-kit (story board, from M4: Second project + epics + story board), shadcn charts; OpenAPI-generated client |
| Runtime | Cloud Run (single service), Cloud Tasks, Cloud Scheduler (weekly scout), Secret Manager |
| Auth | Firebase Auth / Identity Platform (Google) + MCP OAuth facade; GitHub Actions OIDC for agent callbacks |
| Work tracker | Native in Firestore + in-app UI + MCP (ADR-0016) |
| Code host | GitHub App on Andy's personal account; public repos (ADR-0003, ADR-0015) |
| Executors | GitHub Actions (Claude Code, OpenCode), Jules REST API, OpenRouter |
| Release | Cloud Deploy (per project) |
| IaC | Terraform, version pinned in `.terraform-version`, installed with tenv (ADR-0024); provider versions pinned in committed `.terraform.lock.hcl` |
| Telemetry | OpenTelemetry → Cloud Trace / Logging |
| Evals | Ori Eval (scout smoke tests) now; promptfoo later |

---

## 12. Milestones (v1.x)

Each milestone must work **end to end** before the next starts. Acceptance criteria are verified by Andy. Every milestone's "Done when" also requires a system security review with no open high/critical risks, unless Andy accepted them (§9.1).

| ID | Milestone | Outcome |
|---|---|---|
| M0 | Foundations: repo, sign-in, GCP infra | Empty app on Cloud Run, Andy-only sign-in, Terraform in place |
| M1 | First end-to-end flow: ticket → PR with Claude | One project; ticket created from Claude desktop is refined, built by Claude Code, and merged |
| M2 | Add Jules + model routing | Second agent; tiers route work by size; cross-model review |
| M3 | Paid models + spend caps | OpenRouter/OpenCode, hard spend caps, weekly model scout |
| M4 | Second project + epics + story board | Second repo onboarded; epics; drag-and-drop board; config editing |
| M5 | Dev → prod releases | Per-project dev/prod deploys, verification, one-click promote, auto-merge for small tasks |

**Naming:** always write a milestone or slice as `ID: title`, e.g. "M1.2: Ticket core". The ID alone means nothing to a reader.

### How milestones are built: slices
Each milestone is delivered as **slices**. A slice:
- is one PR, branched from the latest `main` after its dependencies have merged — no stacked PRs;
- has its own **Done when** that Andy can check in a few minutes;
- is sized so one agent session can finish it (S ≈ hours, M ≈ a session, L = split it);
- declares its dependencies, so independent slices can run in parallel sessions/worktrees.

`docs/build-log.md` tracks slice status (todo / in progress / PR open / merged) until the system can track its own work. The milestone's **Done when** is checked only after all its slices merge.

### M0: Foundations: repo, sign-in, GCP infra
Repo scaffold, contracts package, Terraform for control-plane GCP project (plan reviewed by Andy), Firestore database (server-only access), auth (UI + API allow-list), CI, ADRs for decisions in this doc.
**Done when:** Andy can sign in to an empty UI on Cloud Run; unauthorized users are rejected; `terraform plan` is clean.

### M1: First end-to-end flow: ticket → PR with Claude
**Done when:** From Claude desktop, Andy creates a ticket → agent asks refinement questions → Andy answers via MCP → ticket reaches Ready → Claude builds → PR opens → Andy merges → run shows in the UI with cost/quota.

**Explicitly not in M1: First end-to-end flow:** drag-and-drop board, epics, dedicated run-detail screen, agent read access to API/MCP, auto-merge, routing beyond the single Claude route.

| Slice | Scope | Size | Depends on | Done when |
|---|---|---|---|---|
| **M1.0: Docs sync** | Bring this revision into the repo; ADRs for: Jules completion via PR webhook (§7.1), agent callback auth via Actions OIDC (§9), rollups via aggregation (§5), M1 scope/slicing (§12), docs upkeep (§14), contract suites for every port (§6). Resolve ADR-0012 with Andy. | S | M0: Foundations | ADRs merged; ADR-0012 accepted or rejected |
| **M1.1: MCP OAuth spike** | Timeboxed (≤1 session). Prove Claude desktop custom connector → `/mcp` with Google-delegated OAuth and the allow-list. Throwaway `ping` tool only. Resolves open question 9. | M | M0: Foundations | Andy adds the connector in Claude desktop and calls `ping`; non-allow-listed account rejected; ADR records the mechanism |
| **M1.2: Ticket core** | Contracts (Project, Ticket, TicketEvent, Question, Run); domain stage machine + DoR (with tests); Firestore store + converters; REST endpoints; Terraform for daily Firestore backup + Cloud Tasks queue + invoker SA. | M | M0: Foundations | API tests pass; `terraform plan` reviewed/applied by Andy; tickets created via API appear in Firestore with events |
| **M1.3: UI: tickets + inbox** | Ticket list grouped by stage, create/edit, detail with history, Needs-you inbox, answer question. | M | M1.2: Ticket core | Andy creates a ticket, sees history, answers a seeded question in the UI |
| **M1.4: MCP core tools** | `create_ticket`, `list_needs_me`, `answer_question`, `status` using the auth proven in M1.1: MCP OAuth spike. | S | M1.1: MCP OAuth spike, M1.2: Ticket core | Same flows as M1.3 work from Claude desktop |
| **M1.5: GitHub App + project registration** | `CodeHost` port + fake + contract suite; register the App (Andy creates it; builder provides manifest/instructions), webhook receiver (HMAC, idempotent by delivery ID), register one project and its repo. | M | M1.2: Ticket core | A PR/check event on the registered repo lands as an idempotent record; replayed delivery is a no-op |
| **M1.6: Claude Code executor** | Reusable workflow; `workflow_dispatch` from the App with run ID; OIDC-authenticated callback; Run records; Cloud Tasks watchdog at deadline; one automatic retry then Needs-you. Use a no-op "echo" step for testing. | L → split if it grows (6a dispatch+callback, 6b watchdog+retry) | M1.5: GitHub App + project registration | An echo run dispatches, calls back, and completes; a killed run is caught by the watchdog and flagged |
| **M1.7: Refinement** | `refine` step on the executor; questions written as structured records → inbox; answering re-runs DoR → Ready. | M | M1.3: UI: tickets + inbox, M1.4: MCP core tools, M1.6: Claude Code executor | A new ticket gets 1–5 questions; answering via MCP moves it to Ready |
| **M1.8: Build + gate** | Dispatcher picks Ready tickets; `build` step opens PR with structured summary and ticket key; all merges gated (Andy); `would_auto_merge` recorded; outcome set from merge/close webhook; cost estimate on the Run. | M | M1.7: Refinement | Ready ticket → PR → Andy merges → ticket advances; Run shows cost estimate and outcome |
| **M1.9: Quota capture** | Timeboxed, best-effort. Capture claude-sub `rate_limits` from runs if available headless; otherwise readings stay **unknown** per policy. UI banner on warn/pause/unknown. | S | M1.6: Claude Code executor | Gauge shows a reading or "unknown"; banner appears at thresholds (test with seeded readings) |

| **M1.10: Security review automation** | Per-PR scans (CodeQL, dependency review, Terraform misconfig scan, workflow linter) as required checks; pin actions to SHAs + Dependabot; per-PR security-review agent workflow; `docs/security/threat-model.md` v1 seeded with known risks; system security review workflow (weekly + manual); `/security-review` and `/threat-model` procedures in `platform/procedures/`. Andy adds the reviewer token secret and required checks. | M | M0: Foundations | A test PR with a planted issue (e.g. over-broad IAM role) gets a high finding and a failing check; the label override works; a manual system review opens a threat-model PR |

Run M1.10: Security review automation first or alongside M1.1 and M1.2, so later slices are reviewed.

Can run in parallel once M1.2: Ticket core merges:
- M1.3: UI: tickets + inbox
- M1.4: MCP core tools (also needs M1.1: MCP OAuth spike)
- M1.5: GitHub App + project registration

### M2: Add Jules + model routing
Jules adapter (completion via PR webhook); freeze `Executor` contract (two adapters pass contract tests); harness/provider/model/tier config with compatibility rules; size-based routing; cross-model review; google-sub quota (task counting) and reserves. Slice at milestone start.

### M3: Paid models + spend caps
OpenCode executor via Actions; OpenRouter direct-call gateway for single-call steps; global and per-project caps with hard stops; quota-aware route fallback with 20% reserves; weekly model scout producing pending tier changes; initial tier list seeded by scout. Slice at milestone start.

### M4: Second project + epics + story board
Second real project onboarded via template + bootstrap, including per-PR security checks and the weekly system security review (§9.1); agent read access to API/MCP scoped per project; epics with child tickets and dependencies; just-in-time re-planning; config editing and audit/revert in UI and MCP; drag-and-drop story board; dedicated run-detail screen. Slice at milestone start.

### M5: Dev → prod releases
Project template Terraform + Cloud Deploy dev→prod; dev deploy + verification (Playwright/API tests + verification agent); promote/rollback from UI and MCP; release notes; rule-based auto-merge for S tasks. Slice at milestone start.

### Later (explicitly deferred)
Prod monitoring agent and alert→ticket flow; write-approval execution; model-based risk scoring; email/Slack digests; transcript storage; BigQuery analytics; promptfoo CI + red-team; Cloud Run Jobs executors; additional harnesses (Antigravity CLI, Codex).

---

## 13. Open questions

Resolved in M0: GitHub home (personal account, public repos — ADR-0003); GCP project `andy-intelligence-512400` in `us-central1` (ADR-0007); Firestore (ADR-0017); default run.app URL (ADR-0007); work tracking native (ADR-0016).

Resolved in M1.0: Docs sync (ADR-0018 – ADR-0024): Jules completion detection (PR webhook + deadline watchdog); agent callback auth (GitHub Actions OIDC); rollups (aggregation queries); M1 scope cuts and slicing; docs upkeep; contract suites for every port (ADR-0012 rejected).

Remaining:

2. Naming convention for per-project dev/prod GCP projects (needed by M5: Dev → prod releases).
5. Claude plan (Pro vs Max) — affects automated-run budget; confirm current billing for Action/headless usage.
6. Google plan (AI Pro vs Ultra) and current Jules daily task quota.
7. OpenRouter: account exists? initial monthly/daily caps?
8. First real side project to onboard in M1: First end-to-end flow (and is andy-intelligence itself project #2 for dogfooding?).
9. Claude custom-connector OAuth mechanism currently supported (dynamic client registration vs static client) — **answered by M1.1: MCP OAuth spike**.
10. Whether the Jules GitHub integration or the Jules REST API should be the dispatch path (REST preferred for run tracking; must support auto-PR creation for the completion signal).

---

## 14. Documentation

Docs are part of the change, not a follow-up. Every slice PR updates the docs its change affects; the reviewer (Andy, or the review gate for managed projects) treats a stale doc like a failing test.

**Style:** short, plain, and readable cold — by someone with no chat history. Lead with the point. Prefer tables and lists to prose. Define a term or ID where it's used. Cut anything that doesn't change what the reader does.

| Doc | Owns | Update when |
|---|---|---|
| `README.md` | What the repo is, how to develop/run/test, layout table, links to the docs below | Commands, env vars, packages/apps, or layout change |
| `docs/architecture/ARCHITECTURE.md` | Current target design and milestone/slice plan (this doc) | Design, scope, or plan changes. Bump `revision` and `last_updated` in the front matter. Never let it describe something the code contradicts. |
| `docs/architecture/adr/NNNN-*.md` | Why a decision was made (MADR) | Any architecture decision or deviation. ADR bodies are immutable; to change a decision write a new ADR and update the old one's `status` (`superseded by` / `amended by`). |
| `docs/build-log.md` | Slice status, pending decisions, blockers | Every slice: start, PR open, merged. Retired once the system tracks its own work. |
| `docs/runbooks/*.md` | Steps Andy runs by hand (setup, secrets, apply, release) | Any manual step is added, changed, or removed |
| `docs/security/threat-model.md` | Assets, trust boundaries, threats, mitigations, open risks | A trust boundary, entry point, credential, or IAM grant is added or changed; after each system security review |
| `docs/BUILD-PROMPT.md` | How a building agent behaves | Operating rules change |
| `AGENTS.md` (`CLAUDE.md` → symlink) | Short, always-loaded rules for agents working in the repo | Rules or doc map change |
| Package/app `README.md` | Only when a package has setup or usage the root README can't cover in a line | That package's usage changes |

Managed projects get the same rule through the template (§8): `docs/features.md` is updated on merge, `docs/architecture/overview.md` when the design changes, ADRs for decisions.

The claude.ai Project holds reference copies of `ARCHITECTURE.md` and `BUILD-PROMPT.md` for planning conversations. **The repo is canonical**; refresh the Project copies when the architecture `revision` changes.
