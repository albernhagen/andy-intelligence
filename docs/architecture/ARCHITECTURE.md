---
title: andy-intelligence — Architecture & Vision
status: accepted (v1.x scope)
owner: Andy
last_updated: 2026-11-03
revision: 2026-11-03j (ADR-0047: Coordinating parallel work in M2 and building andy-intelligence with itself in 3 phases: conflict-aware dispatch, sync runs, merge queue, collision-free IDs, in-flight view, cross-project dependencies; after 2026-11-03g)
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
11. **Usable without the control plane** (later, ADR-0032): the devkit (§7.3) drives the lifecycle from Claude Code alone; the control plane runs on GCP now and locally later.

### Non-goals (v1.x)
- Multi-user / multi-tenant SaaS. (A friend running their own single-tenant install is in scope later: ADR-0032.)
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
9. **No surprise bills.** Everything that scales has a cap; every GCP project has a budget with alerts (§10.1).
10. **Quality is checked locally first.** The same lint/format/type/test checks run on agent edits, commit, push, and CI (§10.2).
11. **Docs ship with the change.** A PR that changes behavior, structure, setup, or a decision updates the affected docs in the same PR (§14). This applies to the control plane and to every managed project.
12. **Agents prove their work; agent config is tested like code.** Every build run reports its verification output, risky work is planned and approved before code, and changes to procedures, prompts and agent rules pass an eval suite before merge (ADR-0040).

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
| **In progress** | Read-only `plan` step writes the plan to the ticket; M/L tickets stay in In progress, flagged Needs-you, until Andy approves it, S tickets continue unless project policy says otherwise (ADR-0040). Then the executor builds (per tier route). One automatic retry, then flags Needs-you | PR opened with structured run summary (plan, deviations, verification output) |
| **Ready for review** | Rule-based gate decides auto-merge vs. Andy | Merged |
| **Monitoring** | CI deploys to dev; verification (smoke/e2e + verification agent) runs; Andy promotes to prod when ready | Dev verification passed (and, if released, prod deploy succeeded) |
| **Done** | Summary included in rollups | — |

**Stage moves** (`packages/domain`): forward one step, plus back for re-refine (ready → backlog), retry (in progress → ready) and rework (ready for review or monitoring → in progress). Backlog → ready requires the DoR. Andy can force any move with a reason; it is recorded in the ticket's history. Agents and the system can't force.

**Needs-you is a flag, not a stage.** Flagged items stay in their stage and appear in the Needs-you inbox (UI + MCP).

### 4.2 Definition of Ready (story)
- Problem/intent stated; acceptance criteria in **EARS** form ("WHEN … THE SYSTEM SHALL …").
- Size tagged S/M/L with one-line justification (`sizeReason`) (rubric in `docs/agent/size-rubric.md`).
- Dependencies declared (ticket "blocked by" links).
- Tier assigned (default from policy, or override).
- **No open questions.** Assumptions listed explicitly.
- Per-project policy may allow "proceed on documented assumptions" for S tasks only; default is **require Andy's answers**.
- **Epics** need only a stated intent and no open questions (no criteria, size or tier).
- Checked in `packages/domain` (`checkDor`); `dorStatus` is computed on every change, never set by callers. EARS = any criterion containing "THE SYSTEM SHALL".

### 4.3 Refinement and questions
- Every story receives a refinement pass: the agent drafts the story, lists assumptions, and asks **1–5 targeted questions** (highest-impact ambiguities first; multiple choice with a suggested default where possible).
- Questions are **structured records** (ticket, text, options, suggested answer, urgency, status, answer, answered_via).
- Andy answers from the UI or MCP. A `/refine` skill in Claude desktop pulls all pending questions across projects for a batched conversational session and writes answers back.
- Answering re-triggers the DoR check.

### 4.4 Epics
- Ticket types (Epic / Story / Task / Bug) + **child tickets** (`parent_id`).
- Epic refinement produces stories with `depends_on`. Stories are vertical slices, independently mergeable behind feature flags; merge to `main`, no long-lived epic branches.
- **Just-in-time re-planning:** when a story unblocks, a short plan pass re-reads the current codebase before execution. (Single tickets get this from M1.18: Plan step, ADR-0040.)
- Epic status, cost, and progress roll up from children. Overrides on an epic cascade to its stories.

### 4.5 Review gate (v1.x: rules only)
- **Hard vetoes → Andy reviews:** protected paths (CODEOWNERS: auth, payments, migrations, infra), dependency changes, CI not green, new behavior without new tests, no verification output in the run summary (ADR-0040), diff > N lines, any agent-raised concern.
- **Otherwise:** S tasks may auto-merge if project policy allows; M/L always go to Andy in v1.x.
- **Dependabot** (ADR-0042): npm patches and minors of 1.0+ packages auto-merge once every required check passes, and deploy only with Andy's next merge; majors, 0.x minors, GitHub Actions and Terraform providers go to Andy. CODEOWNERS (`* @albernhagen`) requests Andy's review on every PR he didn't author; paths listed after `*` are the protected paths above.
- From M1: First end-to-end flow onward, **record what the gate *would* have decided** to build the dataset for later model-based scoring.
- **Adversarial review** on every PR (ADR-0026): a fresh reviewer session tries to find reasons the PR should not merge, with a concrete failing scenario for each finding. Three passes: bugs and logic, plus (from M1.8: Build + gate) compliance with the ticket's acceptance criteria and approved plan; nits capped at 5 (ADR-0040). The implementer answers every finding. Unresolved `blocker` findings are a hard veto unless Andy labels `review-accepted`. From M2/M3 the reviewer is a different vendor than the implementer.
- Security review on every PR (§9.1). A high/critical security finding is a hard veto unless Andy marks it `security-accepted`.

### 4.6 Environments and release
- Per project: separate GCP projects `<app>-dev` and `<app>-prod`.
- **Build once, promote the same image digest** via **Cloud Deploy** (dev → prod, approval required for prod, one-click rollback).
- On merge: deploy to dev → run smoke/e2e (Playwright + API tests) → verification agent summarizes results and logs onto the ticket.
- **Release:** "Promote to prod" from UI or MCP → Cloud Deploy approval → deploy. Release notes generated from tickets in the release.
- Agent write policy: dev writes allowed by project policy; prod is read-only for agents.

---

## 5. Domain model (Firestore documents)

All records carry `project_id` where applicable. Documents are validated with the Zod schemas in `packages/contracts` on every read and write; tickets and their events nest under their project (`projects/{p}/tickets/{t}/events/{e}`). Ticket numbers come from a per-project counter (`counters/tickets-{p}`) in the same transaction as the ticket. Queries use equality filters only (no composite indexes); results are sorted in memory.

**Rollups** (cost per ticket/epic/model/provider) are **computed on read with Firestore aggregation queries** in v1.x — no denormalized counters to keep consistent. Revisit only if reads get measurably slow.

| Entity | Key fields |
|---|---|
| **Project** | name, repos, GCP dev/prod project IDs, policy overrides, budget allocation, autonomy level, enabled |
| **Ticket** (system of record) | key (e.g. `AI-42`), title, body, acceptance criteria (EARS), assumptions, type (epic/story/task/bug), parent, stage, size, size reason, tier, overrides (assignee agent/me, tier, model pin, autonomy, target env), needs_you, DoR status, rank, blocked_by (ticket ids) |
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

---

## 6. Ports (contracts) and adapters

Contracts are defined in `packages/contracts` (Zod schemas + TypeScript interfaces; OpenAPI generated for the API). **Every port has an in-memory fake and a shared contract test suite that every adapter, including the fake, must pass** (ADR-0012 rejected a narrower scope; see ADR-0023). CI runs suites on the fakes; suites that need an emulator (Firestore) run locally on demand (`pnpm test:firestore`, ADR-0034). A port's fake and suite land in the slice that first uses or adapts that port — before its first real adapter.

| Port | Domain concepts | v1.x adapters | Later |
|---|---|---|---|
| `WorkTracker` | Project, Ticket, TicketEvent (history), Question; every write appends its event atomically | **Native (Firestore)** | Markdown in repo (ADR-0032), GitHub Issues, Linear (mirror/export) |
| `CodeHost` | Repo, PullRequest, CheckRun, Merge (v1: `getRepo`, `listInstalledRepos`, `issueRepoToken`; PR/check reads and dispatch come with M1.6: Claude Code executor) | **GitHub App** (`@andy/github`, ADR-0041, ADR-0043) | — |
| `CodeEventLog` | CodeHostEvent (webhook deliveries, recorded once per delivery ID) | **Firestore** (ADR-0041) | Local store (ADR-0032) |
| `CodeHostConnectionStore` | CodeHostConnection (our App: IDs + private key + webhook secret; one per control plane) | **Firestore + Secret Manager** (ADR-0043) | Local store (ADR-0032) |
| `Executor` | RunRequest, RunStatus, RunResult, CompletionSignal, Artifact links | **Claude Code via Actions**, **Jules REST API**, **OpenCode via Actions** | Cloud Run Jobs, Agent SDK, Replicas |
| `ModelGateway` | Completion, Usage, Cost | OpenRouter (direct single-call steps) | LiteLLM, direct providers |
| `QuotaSource` | QuotaReading | Claude statusline/`rate_limits` capture from runs, Jules task counter | Official APIs when available |
| `Notifier` | Notice, Urgency | UI (banner + Needs-you inbox) | Email, Slack, push |
| `Deployer` | Release, Promotion, Rollback | Cloud Deploy | — |
| `Evaluator` | Suite, Case, Score | Agent evals (M1.17: Agent evals v1: procedure/prompt regression suite, tool chosen in the slice); Ori Eval for scout smoke tests | promptfoo, Inspect AI |
| `OAuthGrantStore` | OAuthGrant (code, access token, refresh token; keyed by token hash) | **Firestore** (ADR-0039) | Local store (ADR-0032) |
| `Telemetry` | Trace, Span, CostEvent | OTel → Cloud Trace / Cloud Logging | BigQuery sink |

**Rule:** freeze the `Executor` contract only after **two real adapters** (Claude Code + Jules) work. Vendor terms map to domain terms (a Jules *session* is a `Run`; its *activities* are run events).

---

## 7. Components

### 7.1 Control plane service (Cloud Run)
- **Public URL** (ADR-0044) — `https://ai.andybernhagen.com`: Cloud Run domain mapping (Preview, $0, Google-managed certificate); DNS-only CNAME in Cloudflare, managed by the local-only `infra/dns` root. It is `PUBLIC_URL`: OAuth issuer and MCP resource, GitHub App URLs, Actions OIDC audience, and the only Firebase sign-in domain. The API serves only that host: the default `run.app` URLs answer `GET /health` (monitoring) and `404` for everything else. Cloud Tasks and Scheduler target `PUBLIC_URL` too.
- **API** — REST, OpenAPI-documented, the single entry point for UI and MCP.
- **MCP server** — remote, Streamable HTTP at `/mcp`. Tools generated from API contracts. v1.x tools: `list_projects`, `create_ticket`, `get_ticket`, `refine` (start refinement), `list_needs_me`, `answer_question`, `set_override`, `start`, `status`, `quota`, `promote_release`, `get_config`, `propose_config_change`.
  - Built (M1.4: MCP core tools): `create_ticket` (project key, e.g. `AI`), `list_needs_me`, `answer_question` (recorded `answered_via = mcp`), `status` (ticket key → stage, DoR gaps, questions, last 5 events; no key → projects with ticket counts by stage, Needs-you count, signed-in email). Thin adapters over `TicketService` (`packages/domain`), shared with the REST API; rule violations come back as tool errors. Ticket keys resolve via the project id (= lowercased key). Read cost: `status` with a key reads every ticket in that project; without one, every ticket in every project (as the Needs-you inbox already does per project). Fine for one user (1,000 tickets ≈ $0.0006 of Firestore reads per call; calls need Andy's token, R14 caps token guesses). Add `getTicketByKey` and per-stage counts to the `WorkTracker` port (ADR-0028 cap) before any project passes ~1,000 tickets or M2: Multi-project in parallel, whichever is first. The M1.1 `ping` tool is gone; `status` is the connection check.
- **Webhook receiver** — `POST /webhooks/github`: GitHub App webhooks for PRs, check runs, and workflow runs (ADR-0041). Body ≤ 1 MB → HMAC-SHA256 → ≤ 300 signed deliveries/minute per instance → event type → repo must belong to a project → recorded once per delivery ID (`CodeEventLog`; replays are no-ops). Off unless `GITHUB_APP_ID` is set.
- **Project registration** — `POST /api/projects` with `repos`: each repo must have the control-plane App installed and belongs to one project only (`ProjectService` in `@andy/domain`). Project #1: `albernhagen/andy-intelligence` (key `AI`).
- **GitHub setup** (ADR-0043) — Settings → GitHub runs GitHub's App manifest flow: `GET /api/github/manifest`, GitHub's Create page, `/settings/github/callback` (state checked in the tab), `POST /api/github/connect` saves the App (IDs in Firestore `config/codeHost`, secrets as Secret Manager versions). Credentials are read at runtime (cached 5 minutes). `GET /api/github` lists installed repos.
- **Repo tokens for CI** — `POST /github/token`: a workflow presents its Actions OIDC token (audience = service URL); if `repository` + `workflow_ref` match `TOKEN_POLICY` it gets a 1-hour App token with contents + pull requests write on its repo (ADR-0043). Today: the system security review's `publish` job; M1.6: Claude Code executor and M1.8: Build + gate add theirs.
- **Run completion signals** (event-driven, per executor):
  | Executor | Primary signal | Backup |
  |---|---|---|
  | Claude Code / OpenCode (Actions) | API callback from the workflow (§9 agent callback auth) | `workflow_run` completed webhook |
  | Jules | `pull_request` opened webhook on the PR Jules creates (correlated to the Run by branch/PR body) | Watchdog reads session `activities` once at deadline |
  | Direct | In-process; no signal needed | — |
- **Run watchdog** — when a run is dispatched, a Cloud Tasks task is queued for its deadline. If no completion signal has arrived by then, the watchdog checks the executor/PR directly **once**, then heals the record or flags Needs-you. No periodic polling; nothing runs when no work is in flight.
- **Pipeline engine** — stage transitions, DoR checks, gate rules, dependency release, retry policy. It is the supervisor of parallel work; there is no LLM parent agent (ADR-0047). From M2: conflict-aware dispatch (no two in-flight tickets touching the same files in a repo), sync runs when `main` moves, a merge queue per repo, cross-project dependencies.
- **Router** — picks the route for a step: overrides → tier routes in order → skip providers paused by quota/budget → fall back or queue.
- **Scheduled jobs** (Cloud Scheduler → authenticated endpoint): weekly **model scout**; weekly **system security review** per project when something merged since the last one (§9.1). Quota readings are captured from run results, not sampled.
- **UI** — static SPA served by the same service.

### 7.2 Executors
- **Claude Code**: reusable GitHub Actions workflow using `anthropics/claude-code-action` with `CLAUDE_CODE_OAUTH_TOKEN`; dispatched via `workflow_dispatch` with the run ID (non-secret) as input; reports back via an API callback authenticated with the workflow's GitHub OIDC token. Uses the platform skills plugin and subagents. Runs with a **permission profile** from `platform/` that the project can't override (ADR-0040, built in M1.6: Claude Code executor): no reads of `.env*`, `*.tfvars`, Terraform state or credential files; bypass-permissions mode disabled; tools allowed per step (refine and plan read-only; build edits + the project's own commands); edits to CODEOWNERS paths blocked at edit time; sandbox with a network allowlist if it works on Actions runners.
- **Ticket context for agents** (all executors): the dispatch request carries the ticket snapshot (title, body, acceptance criteria, assumptions, answered questions). In M1: First end-to-end flow, that snapshot plus the callback (report/comment/question on its own ticket) is all an agent gets. From M2: Multi-project in parallel, agents that need more call the API/MCP read-only, scoped to that ticket's project, authenticated the same way (OIDC for Actions runs; a per-run token minted at dispatch for non-Actions executors).
- **OpenCode**: reusable Actions workflow running OpenCode with a per-project OpenRouter key; default harness for non-Claude models. Same callback auth as Claude Code.
- **Jules**: REST API (`sessions`, `activities`, `approvePlan`, `sendMessage`), configured to open a PR on completion. Completion is detected via the PR webhook (§7.1); `activities` are read on demand (watchdog, run detail view), not polled.
- **Direct**: in-process OpenRouter calls for single-call steps (sizing, question drafting where non-agentic, digests, scout analysis).

### 7.3 Skills (platform plugin, versioned) — the devkit
`/ideate`, `/refine`, `/spec`, `/plan-story`, `/build`, `/review`, `/security-review` (per PR), `/threat-model` (system review), `/verify`, `/scout-models`, (later `/digest`).
Substance lives in shared procedure docs (`docs/agent/*.md`) so non-Claude harnesses use the same knowledge; Claude skills/subagents are thin wrappers. Subagents with least-privilege tools: researcher (read-only), designer, critic (read-only), security reviewer (read-only, no shell or network), test-writer, implementer, verifier (run, no edit).

**Build runs prove their work (ADR-0040):** `/build` runs the project's lint/typecheck/test/build commands (listed in its `AGENTS.md`) and puts the results in the run summary; bug tickets commit a failing test first and don't change it afterwards; the verifier does a fresh-context final check.

**Agent evals (ADR-0040):** procedures, skills and agent rules are tested like code. Each case is an input (diff, ticket) plus deterministic checks on the structured output. The `agent-evals` check runs the suite when `platform/procedures/**`, `AGENTS.md`, `template/AGENTS.md` or `.claude/**` change and fails below the pass-rate threshold. Every escaped bug or reverted agent PR adds a case.

**Devkit (ADR-0032, design after M1: First end-to-end flow):** these procedures + skills are a product of their own, in a `devkit/` folder in this repo, published as a Claude Code plugin marketplace. It reaches tools through MCP and works without the control plane: standalone, tickets/questions/status are markdown files in the project repo. The control plane is one host for it.

**Deployment modes (ADR-0032):** `gcp` (this design) and, later, `local` (one process on the user's machine, their own subscription and GitHub). Rule from now on: GCP specifics (Firestore storage for runs/config/spend, Cloud Tasks, Firebase Auth + allow-list) go behind ports when first built or touched, so `local` only adds adapters.

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
- **Tickets** — M1: list view grouped by stage, ticket detail with history and linked runs/PRs/cost, create/edit. M2: filter and group by project. M5: drag-and-drop story board (dnd-kit), epic grouping, overrides editing.
- **Run detail** — M1: run summary inside ticket detail. M5: dedicated screen (metadata, cost, outcome, links out to Action log / Jules session / PR).
- **Config** (providers, harnesses, models, tiers, policies; audit log with revert; pending approvals).
- **Releases** (dev status, promote to prod, rollback).
API client generated from OpenAPI.

**Built in M1.3: UI: tickets + inbox:**
- Routes: `/` Needs-you inbox; `/projects`; `/p/:projectId` tickets in one column per stage; `/p/:projectId/t/:ticketId` detail.
- Detail: edit fields (saves send `ifUpdatedAt`; a 409 conflict asks Andy to reload), Definition of Ready from `/readiness`, history with comments, the ticket's questions, and "Ask a question…" (how Andy seeds one until M1.7: Refinement).
- Moves: one button per move in `TRANSITIONS` (`packages/domain`), plus "Force move…" to any other stage with a reason (skips the transition and DoR rules; recorded in history). The API enforces the rules; its errors show inline.
- Client: `openapi-fetch` typed by `apps/web/src/lib/api.gen.ts`, generated in-process from `createApp`'s OpenAPI document (`pnpm --filter @andy/web gen:api`); a test fails when it is stale. Every write refetches all queries (one user, small data).
- Untrusted text renders as plain React text (no raw HTML or markdown).
- Tests render the UI against the real API in-process (`createApp` + `InMemoryWorkTracker`). Browser e2e (Playwright with the Firebase Auth emulator) is a follow-up.
- Not yet: run/PR/cost panels (no runs before M1.6: Claude Code executor), the kill switch's Needs-you item.

**Built in M1.19: GitHub App setup from the UI:** `/settings/github` (connect, install link, installed repos) and `/settings/github/callback`; the new-project form suggests installed repos.

### 7.6 Context sources (ADR-0033, design after M1: First end-to-end flow)
Product and domain knowledge for agents, pluggable per project, behind a `ContextSource` port:

| Kind | Example | When |
|---|---|---|
| Markdown docs (handwritten or copied-in snapshots) | Product brief, domain glossary, users, business rules, prompts | First (only kind needed now) |
| MCP servers (read-only, per project) | Notion | Later |
| Custom skills | A skill bringing its own context or tools | Later |

Scopes: global (Andy's standards) → project → pipeline step. Same sources for the devkit and the control plane (ADR-0032). Context is untrusted data; a project's agents see only its own sources plus global ones; credentials per project, read-only; external calls and sizes capped.

---

## 8. Project template (what each managed project gets)

```
AGENTS.md                         # rules for all agents (CLAUDE.md symlink)
docs/roadmap.md
docs/features.md                  # living catalog of shipped features (updated on merge)
docs/architecture/overview.md     # current HLD; C4 L1–L2 in Mermaid
docs/architecture/adr/NNNN-*.md   # MADR, immutable
docs/agent/*.md                   # shared procedures: size-rubric, build, review, escalation, security
docs/product/                     # product/domain context sources (§7.6; folder name set in the design)
docs/security/threat-model.md     # living threat model + open risks (§9.1)
specs/NNN-name/{design.md, tech-design.md, tasks.md, stories/*.md, mockups/}
.github/workflows/                # thin callers → platform composite actions, pinned by SHA (ADR-0038)
.andy/baseline.json               # baseline version (andy-intelligence commit) this repo is on
CODEOWNERS                        # `*` requests Andy's review (ADR-0042); further lines = always-gated paths
infra/                            # Terraform: dev/prod Cloud Run, Cloud Deploy pipeline, read-only agent SAs
```
**Required CI checks** on `main`: tests, lint, typecheck, protected-path check, secret scan, security scans and security-review agent (§9.1), "PR references a ticket" (ticket key in branch name or PR body, verified against the control-plane API). These enforce rules for every agent regardless of harness.

Onboarding a project = UI/MCP "Add project" → bootstrap (applies the project baseline, §8.1; until then `platform/baseline/baseline.mjs onboard`, runbook `docs/runbooks/onboard-a-repo.md`: branch ruleset, repo settings, labels, template files, secrets refs, App install check, Terraform PR for GCP) → Andy approves Terraform PR.

### 8.1 Project baseline (ADR-0031)

Every guardrail built in this repo is packaged so each managed project gets it the same way, and this repo is configured from the same baseline. Built in M1.16: Project baseline v1. **Every slice that adds or changes a guardrail updates this table in the same PR.**

Carried by (ADR-0038): **A** = composite action in `platform/actions/`; managed repos get this repo's caller workflow with the action pinned to a commit SHA · **M** = managed file (kept identical; listed in `platform/baseline/manifest.json`) · **S** = seed file, copied once from `template/` · **G** = GitHub config in `platform/baseline/github/`, applied by `platform/baseline/baseline.mjs` · **TF** = Terraform module in `infra/modules/` · **RB** = runbook step (secrets).

Third-party action pins inside `platform/actions/` are bumped by this repo's Dependabot (`/platform/actions/*`); managed repos get them through the baseline pin. Drift: `baseline.mjs check <repo>` (Andy, local, everything); the weekly system security review checks labels and ruleset (its token can't read the rest).

| Guardrail | ADR | Source in this repo | Carried by | Status |
|---|---|---|---|---|
| Lint, typecheck, test, build | 0022 | `ci.yml` (`check`) → `platform/actions/ci-check` | A | carried (M1.16) |
| Workflow linter (actionlint) | 0027 | `ci.yml` → `platform/actions/actionlint` | A | carried (M1.16) |
| Terraform fmt/validate | 0011, 0024 | `ci.yml` → `platform/actions/terraform-check` (skips without `infra/`) | A | carried (M1.16) |
| Public-safe Terraform plan summary | 0011 | `terraform-plan.yml` | — | not yet carried (M6: Dev → prod releases; needs per-project WIF) |
| Secret scan (TruffleHog) | 0015 | `secret-scan.yml` → `platform/actions/secret-scan` | A | carried (M1.16) |
| CodeQL, dependency review, Terraform misconfig scan | 0025, 0030 | `security-scans.yml` → `platform/actions/{codeql,dependency-review,terraform-misconfig}` | A | carried (M1.16) |
| Security-review agent + gate | 0025, 0030, 0037 | `security-review.yml`, `platform/actions/agent-review-*`, `scripts/review-*.mjs`, `platform/procedures/security-review.md` | A | carried (M1.16); procedure read from the pinned commit |
| Adversarial PR review | 0026, 0037 | `adversarial-review.yml`, `platform/actions/agent-review-*`, `scripts/review-gate.mjs`, `platform/procedures/adversarial-review.md` | A | carried (M1.16); procedure read from the pinned commit |
| System security review + drift | 0025, 0030 | `system-security-review.yml`, `platform/procedures/threat-model.md` | — | not yet carried (M6: Dev → prod releases; its drift plan is GCP-specific). Baseline drift for this repo added (M1.16) |
| Local hooks (lefthook) + Claude Code format hook + Prettier config | 0027 | `lefthook.yml`, `.claude/settings.json`, `scripts/format-edited-file.mjs`, `.prettierrc.json` | M | carried (M1.16) |
| Dependabot (npm, Actions; cooldown) | 0025, 0030 | `template/.github/dependabot.yml` (this repo's adds Terraform) | M | carried (M1.16) |
| PR template (docs + security checklist) | 0022, 0025 | `template/.github/pull_request_template.md` | M | carried (M1.16) |
| Agent rules; docs ship with the change | 0022 | `template/AGENTS.md` | S | carried (M1.16) |
| Threat model seed | 0025 | `template/docs/security/threat-model.md` | S | carried (M1.16) |
| Public-repo hygiene (`.gitignore`: tfvars, state, `.env*`) | 0015 | `template/gitignore.lines` | M (lines) | carried (M1.16) |
| `main` ruleset: PR required (squash), no force push/deletion, required checks, code scanning (CodeQL, high or higher) | 0025 | `github/ruleset-main.json` | G | carried (M1.16) |
| Merge settings: squash only, delete branch on merge, auto-merge allowed (Dependabot only, ADR-0042) | 0022, 0042 | `github/repo.json` | G | carried (M1.16; auto-merge from ADR-0042) |
| Dependabot auto-merge: npm patches + stable minors after all required checks; bot merges don't deploy | 0042 | `dependabot-auto-merge.yml` → `platform/actions/dependabot-auto-merge`, `scripts/dependabot-merge.mjs` | A | carried (next baseline tag) |
| CODEOWNERS: Andy requested on every PR (incl. Dependabot) | 0042 | `template/.github/CODEOWNERS` | S | carried (next baseline tag) |
| Security & analysis: Dependabot alerts + security updates, secret scanning, push protection, private vulnerability reporting; CodeQL default setup off | 0015, 0025 | `github/security.json` (dependency graph is always on for public repos) | G | carried (M1.16) |
| Actions: read-only default token; Actions may open PRs; actions must be pinned to a full SHA | 0025, 0038 | `github/actions.json` | G | carried (M1.16) |
| Labels `security-accepted`, `review-accepted` | 0025, 0026 | `github/labels.json` | G | carried (M1.16) |
| Reviewer token secret | 0030 | `CLAUDE_CODE_OAUTH_TOKEN` | RB | carried (M1.16: `docs/runbooks/onboard-a-repo.md`) |
| GCP budget + alerts | 0028, 0029 | `infra/billing` | TF | not yet carried (M6: Dev → prod releases) |
| Cloud Run caps, log exclusions, usage alerts | 0028 | `infra/control-plane` | TF | not yet carried (M6: Dev → prod releases) |
| Cost kill switch (opt-in) | 0028, 0036 | `infra/billing/kill-switch.tf` + workflow YAML | TF | not yet carried (M6: Dev → prod releases) |
| Daily Firestore backup (7-day retention) | 0028 | `infra/control-plane` | TF | not yet carried (M6: Dev → prod releases) |
| Cloud Tasks queue caps (rate, concurrency, retries) | 0028 | `infra/control-plane` | TF | not yet carried (M6: Dev → prod releases) |
| API request body cap (256 KB) | 0028 | `apps/api/src/app.ts` | — | control plane only (product apps choose their own) |
| Agent evals (`agent-evals` check) | 0040 | planned: M1.17: Agent evals v1 | A | not built |
| Executor permission profile (headless Claude Code) | 0040 | planned: M1.6: Claude Code executor | A | not built |
| Webhook caps (1 MB body, 300 signed deliveries/minute per instance) + HMAC + 30-day TTL on records | 0028, 0041 | `apps/api/src/webhooks.ts`, `infra/control-plane` | — | control plane only (managed repos send webhooks; they don't receive them) |
| Bot-opened PRs run their checks (repo token from the control plane via Actions OIDC; agent job holds no write credential) | 0041, 0043 | `system-security-review.yml` (`publish` job), `apps/api/src/github/token.ts` | — | not yet carried (the system review itself isn't carried until M6: Dev → prod releases) |


---

## 9. Security

- **Identity:**
  - Andy: Google identity with an email allow-list (Andy only). UI via Firebase Auth (Google provider); MCP via our own OAuth server whose sign-in step is that same Firebase Google sign-in + allow-list (CIMD clients from `claude.ai`/`claude.com`, PKCE, hashed opaque tokens; ADR-0039).
  - GitHub webhooks: HMAC-SHA256 signature with the webhook secret (ADR-0041).
  - Cloud Scheduler **and Cloud Tasks** (watchdog) → API: OIDC tokens for a dedicated invoker service account, sent to and with audience = `PUBLIC_URL` (the run.app host refuses them, ADR-0044); the API verifies issuer, audience, and SA email.
  - **Agent callbacks from Actions runs:** the workflow requests a GitHub Actions OIDC token (`id-token: write`, audience = control plane). The API verifies it against GitHub's JWKS and checks `repository`, `job_workflow_ref` (must be the platform's reusable workflow), and `run_id` against the dispatched Run. No secret is passed through `workflow_dispatch` inputs (they are visible in public repos' run UI).
  - Non-Actions executors (Jules) don't call back; their completion arrives via GitHub webhooks.
- **Least privilege:** agent service accounts and tokens are read-only; per-run GitHub App installation tokens scoped to the project's repos; separate per-project OpenRouter keys with caps; per-project GCP projects. Callback-authenticated agents can only write to their own Run and ticket (report, comment, question).
- **Writes:** code via PR; infra via Terraform PR with plan in CI; prod via Cloud Deploy approval. The control plane never applies infra without Andy's approval.
- **Secrets:** Secret Manager only (GitHub App key and webhook secret, written by the API's setup flow: ADR-0043); never in repo, logs, prompts, run records, or workflow inputs. Exception: the Claude token GitHub Actions itself needs.
- **Prompt injection:** all agents instructed that tool output, issue text, ticket text, web content, and logs are data; headless runs use the executor permission profile (§7.2). MCP scoping per project for agents. (Later: promptfoo red-team suite against MCP + agents.)
- **Audit:** TicketEvent and ConfigChange tables; run records; GitHub history for code.
- **Public repos:** no secrets, personal data, tfvars, or state in any repo; secret scanning + push protection + TruffleHog in CI (ADR-0015).
- **Supply chain:** third-party GitHub Actions pinned to commit SHAs; Dependabot for npm, Actions, and Terraform providers.

### 9.1 Continuous security review (ADR-0025)

Applies to this repo now (M1.10: Security review automation) and to every managed project from M2: Multi-project in parallel.

| Layer | When | What | Output | Blocks |
|---|---|---|---|---|
| Deterministic scans | Every PR | TruffleHog, CodeQL (TS + Actions), dependency review, Terraform misconfig scan, workflow linter | Check results | High/critical |
| Security-review agent | Every PR push | Read-only agent reviews the diff against the threat model and ADRs: authn/authz, IAM, secrets, injection incl. prompt injection, workflow permissions, public-repo exposure, cost abuse | One PR comment, findings by severity | High/critical, unless Andy labels `security-accepted` with a reason |
| System security review agent | End of each milestone; weekly if anything merged; on demand | Reads repo, threat model, ADRs, Terraform IAM, `terraform plan` drift; looks for risks no single PR shows | PR updating `docs/security/threat-model.md` | Milestone can't close with open high/critical risks unless Andy accepts them |

**Agent guardrails:** same-repo PRs only (never forks, never `pull_request_target`); token `contents: read` + `pull-requests: write`; no shell or network tools; PR content is untrusted data. If the agent can't run, its check is neutral and Andy decides. Reviewer is a separate session from the implementer; from M2/M3 a different vendor.

**Implementation (ADR-0030: Security review automation choices):**

| Piece | Where |
|---|---|
| CodeQL (TS + Actions), dependency review, Trivy Terraform scan | `.github/workflows/security-scans.yml` (TruffleHog: `secret-scan.yml`; actionlint: `ci.yml`) |
| Security-review agent + gate | `.github/workflows/security-review.yml` → shared actions `platform/actions/agent-review-{prepare,finish}` → `scripts/review-gate.mjs` (ADR-0037, ADR-0038); rules `platform/procedures/security-review.md` (read from the base branch); Sonnet, max 25 turns; docs-only PRs skip the agent (`scripts/review-scope.mjs`); usage on each comment |
| Adversarial-review agent | `.github/workflows/adversarial-review.yml`, same actions and gate; rules `platform/procedures/adversarial-review.md`; Sonnet, max 40 turns; later pushes review only new commits + open findings, with owner/collaborator replies as context; `review-accepted` override |
| System security review | `.github/workflows/system-security-review.yml` (Mondays if anything merged; manual) → calls `terraform-plan.yml` for drift → PR editing `docs/security/threat-model.md`; rules `platform/procedures/threat-model.md` |
| Override | `security-accepted` label; removed on every push |
| Action pins | Commit SHAs; Dependabot (npm, Actions, Terraform), 7-day cooldown (`.github/dependabot.yml`) |
| Manual steps | `docs/runbooks/security-review.md` (token secret, label, required checks) |

---

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

---

### 10.4 Data evolution (ADR-0035)
The control plane's Firestore holds real data from M1.2: Ticket core on; there is no separate dev copy.
- **Additive by default:** new optional/defaulted fields need no migration.
- **Breaking change:** bump `SCHEMA_VERSION`, add a tested upgrader `_v N → N+1` applied on read (and rewritten on next write); record it in an ADR.
- **Backups:** daily, kept 7 days (M1.2: Ticket core). Before a risky deploy, run a manual export (runbook). Restore drill once per milestone.
- A separate control-plane dev environment is optional later; moving data then = export/import + the same upgraders.

## 11. Technology choices

| Concern | Choice |
|---|---|
| Language / repo | TypeScript, pnpm workspaces monorepo |
| API | Node HTTP framework with Zod-based OpenAPI generation (builder to propose; e.g., Hono + zod-openapi) |
| MCP | Official MCP TypeScript SDK, Streamable HTTP, OAuth |
| DB | Firestore (Native mode, default database, us-central1; free tier) with Zod-validated converters; no migrations (ADR-0017) |
| UI | React, Vite, shadcn/ui, Tailwind, TanStack Router/Query/Table, dnd-kit (story board, from M5: Epics + story board), shadcn charts; OpenAPI-generated client |
| Runtime | Cloud Run (single service), Cloud Tasks, Cloud Scheduler (weekly scout), Secret Manager |
| Auth | Firebase Auth / Identity Platform (Google) + MCP OAuth facade; GitHub Actions OIDC for agent callbacks |
| Work tracker | Native in Firestore + in-app UI + MCP (ADR-0016) |
| Code host | One GitHub App on Andy's personal account, connected from the UI (ADR-0041, ADR-0043); public repos (ADR-0003, ADR-0015) |
| Executors | GitHub Actions (Claude Code, OpenCode), Jules REST API, OpenRouter |
| Release | Cloud Deploy (per project) |
| IaC | Terraform, version pinned in `.terraform-version`, installed with tenv (ADR-0024); provider versions pinned in committed `.terraform.lock.hcl` |
| Telemetry | OpenTelemetry → Cloud Trace / Logging |
| Evals | Agent evals in CI from M1.17: Agent evals v1 (tool chosen there; promptfoo is the leading candidate); Ori Eval for scout smoke tests |

---

## 12. Milestones (v1.x)

Each milestone must work **end to end** before the next starts. Acceptance criteria are verified by Andy. Every milestone's "Done when" also requires a system security review with no open high/critical risks, unless Andy accepted them (§9.1).

| ID | Milestone | Outcome |
|---|---|---|
| M0 | Foundations: repo, sign-in, GCP infra | Empty app on Cloud Run, Andy-only sign-in, Terraform in place |
| M1 | First end-to-end flow: ticket → PR with Claude | One project; ticket created from Claude desktop is refined, built by Claude Code, and merged |
| M2 | Multi-project in parallel | Several repos onboarded; stories per project; runs across projects at once under caps and quota |
| M3 | Add Jules + model routing | Second agent; tiers route work by size; cross-model review |
| M4 | Paid models + spend caps | OpenRouter/OpenCode, hard spend caps, weekly model scout |
| M5 | Epics + story board | Epics; drag-and-drop board; config editing |
| M6 | Dev → prod releases | Per-project dev/prod deploys, verification, one-click promote, auto-merge for small tasks |

**Renumbered 2026-11-01 (ADR-0035):** M2: Multi-project in parallel was inserted. ADRs written before then mean M3 by "M2", M4 by "M3", M5 by "M4" and M6 by "M5".

**Naming:** always write a milestone or slice as `ID: title`, e.g. "M1.2: Ticket core". The ID alone means nothing to a reader.

### How milestones are built: slices
**With itself (ADR-0047):** 1. track slices as tickets in project `AI` now; 2. S tickets built by the control plane once M1: First end-to-end flow is done; 3. most work, including parallel waves, once M2: Multi-project in parallel is done. Trust-boundary work (auth, IAM, Terraform, workflows, review gates) and deploy-breaking changes stay in interactive sessions.

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
**Done when:** From Claude desktop, Andy creates a ticket → agent asks refinement questions → Andy answers via MCP → ticket reaches Ready → Claude plans (Andy approves the plan if M/L) → Claude builds and reports its verification output → PR opens → Andy merges → run shows in the UI with cost/quota.

**Explicitly not in M1: First end-to-end flow:** drag-and-drop board, epics, dedicated run-detail screen, agent read access to API/MCP, auto-merge, routing beyond the single Claude route.

| Slice | Scope | Size | Depends on | Done when |
|---|---|---|---|---|
| **M1.0: Docs sync** | Bring this revision into the repo; ADRs for: Jules completion via PR webhook (§7.1), agent callback auth via Actions OIDC (§9), rollups via aggregation (§5), M1 scope/slicing (§12), docs upkeep (§14), contract suites for every port (§6). Resolve ADR-0012 with Andy. | S | M0: Foundations | ADRs merged; ADR-0012 accepted or rejected |
| **M1.1: MCP OAuth spike** | Timeboxed (≤1 session). Prove Claude desktop custom connector → `/mcp` with Google-delegated OAuth and the allow-list. Throwaway `ping` tool only. Resolves open question 9. | M | M0: Foundations | Andy adds the connector in Claude desktop and calls `ping`; non-allow-listed account rejected; ADR records the mechanism |
| **M1.2: Ticket core** | Contracts (Project, Ticket, TicketEvent, Question, Run); domain stage machine + DoR (with tests); Firestore store + converters; REST endpoints; Terraform for daily Firestore backup + Cloud Tasks queue (max rate/concurrency caps, ADR-0028) + invoker SA. | M | M0: Foundations | API tests pass; `terraform plan` reviewed/applied by Andy; tickets created via API appear in Firestore with events |
| **M1.3: UI: tickets + inbox** | Ticket list grouped by stage, create/edit, detail with history, Needs-you inbox, answer question. | M | M1.2: Ticket core | Andy creates a ticket, sees history, answers a seeded question in the UI |
| **M1.4: MCP core tools** | `create_ticket`, `list_needs_me`, `answer_question`, `status` using the auth proven in M1.1: MCP OAuth spike. | S | M1.1: MCP OAuth spike, M1.2: Ticket core | Same flows as M1.3 work from Claude desktop |
| **M1.5: GitHub App + project registration** | `CodeHost` port + fake + contract suite; register the App (Andy creates it; builder provides manifest/instructions), webhook receiver (HMAC, idempotent by delivery ID), register one project and its repo; switch PRs opened by workflows (system security review) to an App installation token so their checks run without manual approval. | M | M1.2: Ticket core | A PR/check event on the registered repo lands as an idempotent record; replayed delivery is a no-op |
| **M1.6: Claude Code executor** | Reusable workflow; `workflow_dispatch` from the App with run ID; OIDC-authenticated callback; Run records; Cloud Tasks watchdog at deadline; one automatic retry then Needs-you. Use a no-op "echo" step for testing. **Permission profile** for headless runs (§7.2, ADR-0040) in 6a; threat model gets ticket text as untrusted input. | L → split if it grows (6a dispatch+callback, 6b watchdog+retry) | M1.5: GitHub App + project registration, M1.19: GitHub App setup from the UI | An echo run dispatches, calls back, and completes; a killed run is caught by the watchdog and flagged; an echo run that tries to read `.env` or edit a CODEOWNERS path is refused |
| **M1.7: Refinement** | `refine` step on the executor; questions written as structured records → inbox; answering re-runs DoR → Ready. | M | M1.3: UI: tickets + inbox, M1.4: MCP core tools, M1.6: Claude Code executor | A new ticket gets 1–5 questions; answering via MCP moves it to Ready |
| **M1.8: Build + gate** | Dispatcher picks Ready tickets; `build` step opens PR with structured summary (ticket key, approved plan, deviations, verification output); bug tickets commit a failing test first; verifier subagent; gate vetoes a PR without verification output; adversarial procedure adds the acceptance-criteria + plan pass and the nit cap of 5; all merges gated (Andy); `would_auto_merge` recorded; outcome set from merge/close webhook; cost estimate and metrics (CI green on first try, review blockers, Andy's commits before merge, rework) on the Run (ADR-0040). | M | M1.7: Refinement, M1.16: Project baseline v1, M1.17: Agent evals v1, M1.18: Plan step | Ready ticket → plan → PR with verification output → Andy merges → ticket advances; Run shows cost estimate, outcome and metrics; a PR summary without verification output is vetoed |
| **M1.9: Quota capture** | Timeboxed, best-effort. Capture claude-sub `rate_limits` from runs if available headless; otherwise readings stay **unknown** per policy. UI banner on warn/pause/unknown. | S | M1.6: Claude Code executor | Gauge shows a reading or "unknown"; banner appears at thresholds (test with seeded readings) |
| **M1.17: Agent evals v1** | Eval suite for the agent configuration (ADR-0040): `Evaluator` port + fake + contract suite; cases = input (diff, ticket) + deterministic checks on structured output; seed cases from the review demos (PR #12, PR #22: planted bugs must get a high/critical or `blocker`) and clean diffs (no blocker); required `agent-evals` check that runs when `platform/procedures/**`, `AGENTS.md`, `template/AGENTS.md` or `.claude/**` change, passes without running otherwise, fails below the pass-rate threshold; capped cases/turns per run (subscription quota). Pick the tool first (promptfoo is the candidate). Later slices add cases for their procedures (refine, plan, build). | M | M1.11: Adversarial PR review, M1.16: Project baseline v1 | A PR that weakens the adversarial procedure (e.g. drops the failing-scenario rule) fails `agent-evals`; reverting it passes; a code-only PR skips the run |
| **M1.18: Plan step** | Read-only `plan` step on the executor (ADR-0040): plan (files, order of work, tests, riskiest step, rejected alternatives) stored on the ticket, shown in UI and MCP; plan runs and approval happen in In progress (the plan run counts against dispatch caps and quota; while waiting, the ticket is flagged Needs-you and holds no run), M/L tickets wait for Andy's approval, S tickets continue unless project policy says otherwise; approve/reject (with a reason → re-plan) from UI and MCP; build reads the approved plan. Eval cases for the plan procedure. | M | M1.6: Claude Code executor, M1.7: Refinement | An M ticket dispatched from Ready gets a plan and waits in In progress, flagged Needs-you; Andy approves it via MCP and build starts; rejecting with a reason produces a new plan; an S ticket goes straight to build |
| **M1.19: GitHub App setup from the UI** | Replace M1.5's manual App setup (ADR-0043): connect from Settings → GitHub (manifest flow, state check, API writes the secrets); `CodeHostConnectionStore` port + fake + contract suite + GCP adapter; credentials read at runtime; installed-repo list and picker; `POST /github/token` (Actions OIDC → repo token, `TOKEN_POLICY`); system review opens its PR with it from a separate `publish` job; review bot App removed. | M | M1.5: GitHub App + project registration | From a fresh state Andy connects GitHub, installs the App and registers `AI` from the UI with no terminal step after the Terraform apply; a PR event is recorded and a redelivery is `duplicate`; the system review's PR is opened by the App and its checks run on their own |
| **M1.20: Custom domain** | Serve the control plane at `https://ai.andybernhagen.com` (ADR-0044): Cloud Run domain mapping; `infra/dns` (Cloudflare CNAME + Search Console TXT, local plans only); `PUBLIC_URL`, Firebase authorized domains and the system review's OIDC audience on the new host; runbook for the cutover, GitHub App URLs and the Claude connector. | S | M1.19: GitHub App setup from the UI | `https://ai.andybernhagen.com/health` returns 200 with a valid certificate; Google sign-in, the MCP connector and a GitHub webhook redelivery work there |
| **M1.10: Security review automation** | Per-PR scans (CodeQL, dependency review, Terraform misconfig scan, workflow linter) as required checks; pin actions to SHAs + Dependabot; per-PR security-review agent workflow; `docs/security/threat-model.md` v1 seeded with known risks; system security review workflow (weekly + manual); `/security-review` and `/threat-model` procedures in `platform/procedures/`. Andy adds the reviewer token secret and required checks. | M | M0: Foundations | A test PR with a planted issue (e.g. over-broad IAM role) gets a high finding and a failing check; the label override works; a manual system review opens a threat-model PR |
| **M1.11: Adversarial PR review** | Adversarial reviewer agent on every PR (ADR-0026) reusing M1.10 plumbing; reviewer procedure in `platform/procedures/`; `adversarial-review` check fails on unresolved blockers; `review-accepted` override label. | M | M1.10: Security review automation | A test PR with a planted bug (e.g. off-by-one with no test) gets a `blocker` with a failing scenario; replying + fixing clears the check; the label override works |
| **M1.12: Local quality gates** | Git hooks (commit: format/lint/`terraform fmt`/workflow lint on staged files; push: typecheck + tests) installed by `pnpm install`; Claude Code hook formats and lints edited files (ADR-0027). | S | M0: Foundations | A commit with a lint error is blocked locally; an agent edit is auto-formatted; CI adds actionlint (Andy, 2026-10-28) |
| **M1.13: GCP cost guardrails** | `infra/billing` root with a $25/month budget and alerts (local plans only); Cloud Run timeout/concurrency set; Cloud Tasks caps when the queue lands; log exclusions; kill switch documented, not built (ADR-0028, ADR-0029). Andy applies. | S | M0: Foundations | Budget visible in Billing with alert thresholds; Andy confirmed as a default alert recipient and Google Cloud mail reaching his inbox (Google has no test-alert feature); kill switch documented and off |
| **M1.14: Cost kill switch** | Opt-in `kill_switch_enabled` (default off): budget → Pub/Sub at 150% → function scales Cloud Run to zero and pauses any Cloud Tasks queues; never disables billing; re-enable steps in the billing runbook (ADR-0028). Verify the scale-to-zero mechanism first. Raising a Needs-you item is a follow-up once M1.2: Ticket core merges (the budget email covers it until then). | M | M1.13: GCP cost guardrails | With the switch on and a test budget, a budget message takes the service offline; with it off, nothing is deployed |
| **M1.16: Project baseline v1** | Package every guardrail in §8.1 (ADR-0031, ADR-0038): move CI/security steps to composite actions in `platform/actions/` (scripts and procedures read from the pinned SHA) and make this repo call them; `template/` repo files + `platform/baseline/manifest.json`; `platform/baseline/github/` (ruleset, security & analysis, Actions settings, labels) + idempotent apply script with `--dry-run` diff + drift check; runbook "Onboard a repo". Verify reusable-workflow limits (secrets, permissions, nesting) first. | M | M1.10: Security review automation, M1.11: Adversarial PR review, M1.12: Local quality gates | One command brings a scratch repo to the baseline and its test PR shows the same checks as this repo; re-running reports no drift; a setting changed by hand shows up as drift |
| **M1.15: Usage alerts** | Cloud Monitoring alert policies in `infra/control-plane` (email to Andy, address in gitignored tfvars + `TF_VAR_ALERT_EMAIL` Actions secret) on Cloud Run request rate, internet egress, Firestore read/write rate and log ingestion; thresholds well above normal use. Verify current alerting prices first (expected well under $1/month). | S | M1.13: GCP cost guardrails | Each policy visible in Monitoring; a temporarily lowered threshold fires an email within minutes |

Order (Andy, 2026-10-28): M1.12: Local quality gates → M1.10: Security review automation → M1.2: Ticket core ‖ M1.1: MCP OAuth spike (in parallel) → M1.14: Cost kill switch → M1.11: Adversarial PR review → M1.16: Project baseline v1 (before M1.8: Build + gate). M1.2: Ticket core, M1.10, M1.11, M1.12, M1.13: GCP cost guardrails, M1.14: Cost kill switch and M1.15: Usage alerts are merged.

Waves after M1.4: MCP core tools and M1.5: GitHub App + project registration (ADR-0040): M1.19: GitHub App setup from the UI → M1.6a ‖ M1.17: Agent evals v1 → M1.6b ‖ M1.7: Refinement ‖ M1.9: Quota capture → M1.18: Plan step → M1.8: Build + gate.

Can run in parallel once M1.2: Ticket core merges:
- M1.3: UI: tickets + inbox
- M1.4: MCP core tools (also needs M1.1: MCP OAuth spike)
- M1.5: GitHub App + project registration

### M2: Multi-project in parallel
Andy builds several systems at once (ADR-0035). Onboard N projects via M1.5: GitHub App + project registration and M1.16: Project baseline v1, each with per-PR security and adversarial review, local quality gates and the weekly system security review (§9.1, §4.5, §10.2); **stories by project**: tickets listed, filtered and grouped per project in the UI and MCP (`list_projects`, per-project ticket lists, Needs-you inbox grouped by project); concurrent runs across projects with explicit caps (max runs per project and globally, ADR-0028); quota-aware dispatch so parallel runs keep the subscription reserves (§5); agent read access to API/MCP scoped per project; coordination of parallel work (ADR-0047): conflict-aware dispatch from the plan's touched files, sync runs that bring open agent PRs up to date with `main`, a merge queue per repo via the App token, collision-free ADR and risk IDs, an in-flight view in MCP, cross-project dependencies; dispatch also capped by PRs waiting for Andy (review capacity), and repeated review findings become a pending `ConfigChange` to `AGENTS.md` or a procedure (ADR-0040). Slice at milestone start.

### M3: Add Jules + model routing
Jules adapter (completion via PR webhook); freeze `Executor` contract (two adapters pass contract tests); harness/provider/model/tier config with compatibility rules; size-based routing; cross-model review; google-sub quota (task counting) and reserves. Slice at milestone start.

### M4: Paid models + spend caps
OpenCode executor via Actions; OpenRouter direct-call gateway for single-call steps; global and per-project caps with hard stops; quota-aware route fallback with 20% reserves; weekly model scout producing pending tier changes; initial tier list seeded by scout. Slice at milestone start.

### M5: Epics + story board
Epics with child tickets and dependencies; just-in-time re-planning; config editing and audit/revert in UI and MCP; drag-and-drop story board; dedicated run-detail screen. Slice at milestone start.

### M6: Dev → prod releases
Project template Terraform + Cloud Deploy dev→prod, with a budget and caps per dev/prod project (§10.1); dev deploy + verification (Playwright/API tests + verification agent); promote/rollback from UI and MCP; release notes; rule-based auto-merge for S tasks; DORA metrics (deploy frequency, lead time, change failure rate, time to restore; ADR-0040). Slice at milestone start.

### Later (explicitly deferred)
After M6: Dev → prod releases: **per-project custom domains**. (The control plane's own domain moved up to M1.20: Custom domain, ADR-0044.)

**Devkit standalone + local mode** (ADR-0032): phase 1 devkit in Claude Code with markdown tickets; phase 2 full control plane locally. Designed after M1: First end-to-end flow.

**Context sources** (ADR-0033, §7.6): `ContextSource` port, project manifest, MCP and skill sources (Notion first, when wanted). Designed after M1: First end-to-end flow.

Prod monitoring agent and alert→ticket flow; write-approval execution; model-based risk scoring; email/Slack digests; transcript storage; BigQuery analytics; promptfoo red-team; read-only agent that triages a failed `main` build (ADR-0040); Cloud Run Jobs executors; additional harnesses (Antigravity CLI, Codex).

---

## 13. Open questions

Resolved in M0: GitHub home (personal account, public repos — ADR-0003); GCP project `andy-intelligence-512400` in `us-central1` (ADR-0007); Firestore (ADR-0017); default run.app URL (ADR-0007; replaced by `ai.andybernhagen.com` in M1.20: Custom domain, ADR-0044); work tracking native (ADR-0016).

Resolved in M1.0: Docs sync (ADR-0018 – ADR-0024): Jules completion detection (PR webhook + deadline watchdog); agent callback auth (GitHub Actions OIDC); rollups (aggregation queries); M1 scope cuts and slicing; docs upkeep; contract suites for every port (ADR-0012 rejected).

Remaining:

2. Naming convention for per-project dev/prod GCP projects (needed by M6: Dev → prod releases).
5. Claude plan (Pro vs Max) — affects automated-run budget; confirm current billing for Action/headless usage.
6. Google plan (AI Pro vs Ultra) and current Jules daily task quota.
7. OpenRouter: account exists? initial monthly/daily caps?
8. ~~First real side project to onboard in M1: First end-to-end flow~~ — **answered in M1.5: GitHub App + project registration**: andy-intelligence itself is project #1 (ADR-0041); side projects in M2: Multi-project in parallel.
9. ~~Claude custom-connector OAuth mechanism currently supported (dynamic client registration vs static client)~~ — **answered by M1.1: MCP OAuth spike**: CIMD against our own authorization server (ADR-0039).
10. Whether the Jules GitHub integration or the Jules REST API should be the dispatch path (REST preferred for run tracking; must support auto-PR creation for the completion signal).
11. Local mode design (ADR-0032): markdown ticket format, local executor (Claude Code CLI) and its trust boundary, local storage/queue/auth adapters, devkit packaging and versioning. Due after M1: First end-to-end flow.
12. Context sources design (ADR-0033): folder name and manifest format, step-to-source mapping, `ContextSource` port shape, MCP registration per project. Due after M1: First end-to-end flow.

---

## 14. Documentation

Docs are part of the change, not a follow-up. Every slice PR updates the docs its change affects; the reviewer (Andy, or the review gate for managed projects) treats a stale doc like a failing test.

**Style:** short, plain, and readable cold — by someone with no chat history. Lead with the point. Prefer tables and lists to prose. Define a term or ID where it's used. Cut anything that doesn't change what the reader does.

| Doc | Owns | Update when |
|---|---|---|
| `README.md` | What the repo is; **How it works today** (what's built, how to use it, how it works; one screen, ADR-0040); how to develop/run/test, layout table, links to the docs below | Commands, env vars, packages/apps, or layout change; a feature, component or way of using the system is added or changed |
| `docs/architecture/ARCHITECTURE.md` | Current target design and milestone/slice plan (this doc) | Design, scope, or plan changes. Bump `revision` and `last_updated` in the front matter. Never let it describe something the code contradicts. |
| `docs/architecture/adr/NNNN-*.md` | Why a decision was made (MADR) | Any architecture decision or deviation. ADR bodies are immutable; to change a decision write a new ADR and update the old one's `status` (`superseded by` / `amended by`). |
| `docs/build-log.md` | Slice status, pending decisions, blockers | Every slice: start, PR open, merged. Retired once the system tracks its own work. |
| `docs/runbooks/*.md` | Steps Andy runs by hand (setup, secrets, apply, release) | Any manual step is added, changed, or removed |
| `docs/security/threat-model.md` | Assets, trust boundaries, threats, mitigations, open risks | A trust boundary, entry point, credential, or IAM grant is added or changed; after each system security review |
| `docs/BUILD-PROMPT.md` | How a building agent behaves | Operating rules change |
| `AGENTS.md` (`CLAUDE.md` → symlink) | Short, always-loaded rules for agents working in the repo | Rules or doc map change |
| §8.1 Project baseline inventory | Every guardrail and how managed projects get it | A quality, security, cost or scaling guardrail is added or changed |
| Package/app `README.md` | Only when a package has setup or usage the root README can't cover in a line | That package's usage changes |

Managed projects get the same rule through the template (§8): `docs/features.md` is updated on merge, `docs/architecture/overview.md` when the design changes, ADRs for decisions.

The claude.ai Project holds reference copies of `ARCHITECTURE.md` and `BUILD-PROMPT.md` for planning conversations. **The repo is canonical**; refresh the Project copies when the architecture `revision` changes.
