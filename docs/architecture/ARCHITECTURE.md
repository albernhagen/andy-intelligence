---
title: andy-intelligence — Architecture & Vision
status: accepted (v1.x scope)
owner: Andy
---

# andy-intelligence — Architecture & Vision

A personal, single-tenant **control plane for agentic software development** across many side projects. It turns ideas into refined tickets, routes work to the right agent/model under cost and quota controls, ships to dev with self-verification, gives Andy a one-click release to prod, and keeps him informed through a single "Needs you" surface.

Enterprise-shaped (durable state, policy, gates, least privilege, audit, contract-first) but sized for one person.


**How to read this doc (ADR-0046: Context budget):** don't load it whole. Read your slice's row in §12 and the sections it names.

| Section | Read when |
|---|---|
| §1–3 Goals, principles, overview | New to the project, or a change touches scope |
| §4 Workflow (stages, DoR, refinement, gate, release) | Ticket rules, pipeline, review gate |
| §5 Domain model · §6 Ports | Data model, contracts, adapters |
| §7 Components (API/MCP, executors, skills, UI, context sources) | Building one of them |
| §8 Template · §8.1 Baseline inventory | Managed-repo files or any guardrail |
| §9 Security · §10 Observability and cost | Auth, IAM, secrets, caps, alerts, data |
| §11 Technology | Adding a library or service |
| §12 Milestones and slices | Every slice: your row |
| §13 Open questions · §14 Documentation | Decisions pending; which doc to update |

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
- Email/Slack notifications (UI only for now; `Notifier` port exists; push from the phone in M7: Mobile, ADR-0052).
- Custom sandboxes / Cloud Run Jobs executors (GitHub Actions is the executor runtime).

---

## 2. Core principles

1. **LLMs decide; deterministic systems hold state.** Agents refine, split, size, design, implement, review. State lives in Firestore; the control-plane service itself is stateless. Flow is **event-driven** (callbacks, webhooks, queued tasks), not polling. The only active check of an external system is the per-run watchdog at its deadline (§7.1).
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
| **In progress** | The executor's build run starts read-only and writes a plan into its summary, then implements it (ADR-0050). If the project's `planApproval` policy applies (`none` by default; `m-and-l` or `all`), the run stops after the plan, the ticket is flagged Needs-you, and build starts when Andy approves. One automatic retry, then flags Needs-you | PR opened with structured run summary (plan, deviations, verification output) |
| **Ready for review** | Rule-based gate decides auto-merge vs. Andy | Merged |
| **Monitoring** | CI deploys to dev; verification (smoke/e2e + verification agent) runs; Andy promotes to prod when ready | Dev verification passed (and, if released, prod deploy succeeded) |
| **Done** | Summary included in rollups | — |
| **Cancelled** | Andy cancelled it; runs stop, questions withdrawn | Andy reopens it to Backlog |

**Stage moves** (`packages/domain`): forward one step, plus back for re-refine (ready → backlog), retry (in progress → ready) and rework (ready for review or monitoring → in progress). Backlog → ready requires the DoR. Only Andy forces (reason optional, ADR-0057; history marks it), cancels (not a move), reopens, archives; MCP `move_ticket` moves one step forward. **Archived** (Done/Cancelled only) hides it from board, inbox, counts.

**Same-repo PRs move tickets:** key from the PR's head branch, else its description's first line (first `KEY-n` of the repo's project); the webhook records `pr_linked`, then moves it as `system`, stepwise from Ready: opened (not draft) → Ready for review; merged into the default branch → Done (via Monitoring, ADR-0056); closed unmerged → In progress + Needs-you.

**Needs-you is a flag, not a stage.** Flagged items stay in their stage and appear in the Needs-you inbox (UI + MCP).

### 4.2 Definition of Ready (story)
- Problem/intent stated; acceptance criteria in **EARS** form ("WHEN … THE SYSTEM SHALL …").
- Size tagged S/M/L with one-line justification (`sizeReason`) (rubric in `docs/agent/size-rubric.md`).
- Dependencies declared (ticket "blocked by" links).
- Tier assigned (default from policy, or override).
- **No open questions.** Assumptions listed explicitly.
- Per-project policy may allow "proceed on documented assumptions" for S tasks only; default is **require Andy's answers**. Overnight runs (ADR-0049) answer everything before launch and decide later ambiguity on recorded assumptions, listed in the morning report.
- **Epics** need only a stated intent and no open questions (no criteria, size or tier).
- Checked in `packages/domain` (`checkDor`); `dorStatus` is computed on every change, never set by callers. EARS = any criterion containing "THE SYSTEM SHALL".

### 4.3 Refinement and questions
- Every story receives a refinement pass: the agent drafts the story, lists assumptions, and asks **1–5 targeted questions** (highest-impact ambiguities first; multiple choice with a suggested default where possible).
- Questions are **structured records** (§5 Question).
- Andy answers in UI or MCP. A `/refine` skill in Claude desktop batches pending questions across projects into one conversation.
- Answering re-checks the DoR; the last answer moves a Backlog ticket that meets it to Ready (`system`, `ifUpdatedAt`).
- **Built (M1.7, ADR-0054):** refine starts on events (ticket created, last answer leaving the DoR unmet, run ended), oldest ticket first, unless `autoRefine` is off. ≤ 3 runs per ticket; output written once per run, size and tier only where unset; failures flag Needs-you.

### 4.4 Epics
- Ticket types (Epic / Story / Task / Bug) + **child tickets** (`parent_id`).
- Epic refinement produces stories with `depends_on`. Stories are vertical slices, independently mergeable behind feature flags; merge to `main`, no long-lived epic branches. Exception: an **overnight run** (ADR-0049) merges its stories into a one-night branch `epic/<key>`, reviewed by Andy as one PR the next morning.
- **Just-in-time re-planning:** when a story unblocks, a short plan pass re-reads the current codebase before execution. (Single tickets get it as the plan section of every build run, M1.8: Build + gate, ADR-0050.)
- Epic status, cost, and progress roll up from children. Overrides on an epic cascade to its stories.

### 4.5 Review gate (v1.x: rules only)
- **Hard vetoes → Andy reviews:** protected paths (CODEOWNERS: auth, payments, migrations, infra), dependency changes, CI not green, new behavior without new tests, no verification output in the run summary (ADR-0040), diff > N lines, any agent-raised concern.
- **Otherwise:** agent PRs merge on their own once every required check and both review agents pass (from M1.8: Build + gate, ADR-0050), per the project's `autoMerge` policy: `none` / `s` / `s-and-m` (default) / `all`.
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
| **Ticket** (system of record) | key (e.g. `AI-42`), title, body, acceptance criteria (EARS), assumptions, type (epic/story/task/bug), parent, stage, size, size reason, tier, overrides (assignee agent/me, tier, model pin, autonomy, target env), needs_you, DoR status, rank, blocked_by (ticket ids), archived |
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

---

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

---

## 7. Components

### 7.1 Control plane service (Cloud Run)
- **Public URL** (ADR-0044) — `https://ai.andybernhagen.com`: Cloud Run domain mapping (Preview, $0, Google-managed certificate); DNS-only CNAME in Cloudflare, managed by the local-only `infra/dns` root. It is `PUBLIC_URL`: OAuth issuer and MCP resource, GitHub App URLs, Actions OIDC audience, and the only Firebase sign-in domain. The API serves only that host: the default `run.app` URLs answer `GET /health` (monitoring) and `404` for everything else. Cloud Tasks and Scheduler target `PUBLIC_URL` too.
- **API** — REST, OpenAPI-documented, the single entry point for UI and MCP.
- **MCP server** — remote, Streamable HTTP at `/mcp`. Tools generated from API contracts. v1.x tools: `list_projects`, `create_ticket`, `get_ticket`, `refine` (start refinement), `list_needs_me`, `answer_question`, `set_override`, `start`, `status`, `quota`, `promote_release`, `get_config`, `propose_config_change`.
  - Built (M1.4: MCP core tools; from M1.7: `refine`, `set_auto_refine`): `create_ticket` (project key, e.g. `AI`), `list_needs_me`, `answer_question` (`answered_via = mcp`), `status` (ticket key → stage, DoR gaps, questions, last 5 events; no key → unarchived counts by stage, Needs-you count, signed-in email; connection check); `move_ticket` (one step forward); `cancel_ticket`, `archive_ticket`. Thin adapters over `TicketService`, shared with the REST API; rule violations are tool errors. Key lookups and the refine dispatcher read the whole project; no key, every project (≈ $0.0006 at 1,000 tickets); add `getTicketByKey` and per-stage counts (ADR-0028) before ~1,000 tickets or M2: Multi-project in parallel.
- **Webhook receiver** — `POST /webhooks/github`: GitHub App webhooks for PRs, check runs, and workflow runs (ADR-0041). Body ≤ 1 MB → HMAC-SHA256 → ≤ 300 signed deliveries/minute per instance → event type → repo must belong to a project → recorded once per delivery ID (`CodeEventLog`; replays are no-ops) → a new `pull_request` delivery moves its ticket (§4.1). Off unless `GITHUB_APP_ID` is set.
- **Project registration** — `POST /api/projects` with `repos`: each repo must have the control-plane App installed and belongs to one project only (`ProjectService` in `@andy/domain`). Project #1: `albernhagen/andy-intelligence` (key `AI`).
- **GitHub setup** (ADR-0043) — Settings → GitHub runs GitHub's App manifest flow: `GET /api/github/manifest`, GitHub's Create page, `/settings/github/callback` (state checked in the tab), `POST /api/github/connect` saves the App (IDs in Firestore `config/codeHost`, secrets as Secret Manager versions). Credentials are read at runtime (cached 5 minutes). `GET /api/github` lists installed repos.
- **Repo tokens for CI** — `POST /github/token`: a workflow presents its Actions OIDC token (audience = service URL); if `repository` + `workflow_ref` match `TOKEN_POLICY` it gets a 1-hour App token with contents + pull requests write on its repo (ADR-0043). Today: the system security review's `publish` job; M1.8: Build + gate adds the executor's (refine runs are read-only).
- **Agent runs** (M1.6a, ADR-0051) — Andy or the refine dispatcher (§4.3) starts a run on a ticket (`POST /api/projects/{p}/tickets/{t}/runs`, step `refine`; this repo only until M2; one run in flight per project, re-checked after create). `RunService` creates the Run (prompt, deadline), dispatches `agent-run.yml` via the App (run ID, credential kind), records the workflow run ID. The run calls `GET /runs/{id}/context` (its prompt; marks it running) and `POST /runs/{id}/report` (result; summary → ticket comment by `agent:<run>`, refine output → questions, §4.3) with its Actions OIDC token; `repository`, `job_workflow_ref` and `run_id` must match the Run (§9). A replayed report is a no-op.
- **Run completion signals** (event-driven, per executor):
  | Executor | Primary signal | Backup |
  |---|---|---|
  | Claude Code / OpenCode (Actions) | API callback from the workflow (§9 agent callback auth) | `workflow_run` completed webhook |
  | Jules | `pull_request` opened webhook on the PR Jules creates (correlated to the Run by branch/PR body) | Watchdog reads session `activities` once at deadline |
  | Direct | In-process; no signal needed | — |
- **Run watchdog** (M1.6b, ADR-0055) — each dispatched run queues one check at its deadline (Cloud Tasks, one task per run) for `POST /runs/{id}/watchdog` (§9). Unreported, it asks the executor **once**: finished → heal the Run; failed, killed or overdue → one automatic retry (as after a reported failure); a failed retry flags Needs-you.
- **Pipeline engine** — stage transitions, DoR checks, gate rules, dependency release, retry policy. It is the supervisor of parallel work; there is no LLM parent agent (ADR-0047). From M2: conflict-aware dispatch (no two in-flight tickets touching the same files in a repo), sync runs when `main` moves, a merge queue per repo, cross-project dependencies.
- **Router** — picks the route for a step: overrides → tier routes in order → skip providers paused by quota/budget → fall back or queue.
- **Scheduled jobs** (Cloud Scheduler → authenticated endpoint): weekly **model scout**; weekly **system security review** per project when something merged since the last one (§9.1). Quota readings are captured from run results, not sampled.
- **UI** — static SPA served by the same service.

### 7.2 Executors
- **Claude Code**: reusable GitHub Actions workflow using `anthropics/claude-code-action` with `CLAUDE_CODE_OAUTH_TOKEN`; dispatched via `workflow_dispatch` with the run ID (non-secret) as input; reports back via an API callback authenticated with the workflow's GitHub OIDC token. Uses the platform skills plugin and subagents. **Context per step** (ADR-0046): ticket snapshot, approved plan and `AGENTS.md` only; exploration in subagents that return summaries; `--max-turns` per step; a stable prompt prefix so caching works; input tokens recorded per run and step. Runs with a **permission profile** from `platform/` that the project can't override (ADR-0040, built in M1.6: Claude Code executor): no reads of `.env*`, `*.tfvars`, Terraform state or credential files; bypass-permissions mode disabled; tools allowed per step (refine and plan read-only; build edits + the project's own commands); edits to CODEOWNERS paths blocked at edit time; sandbox with a network allowlist if it works on Actions runners. **Built (M1.6a, ADR-0051):** `claude-executor.yml`, three jobs so the agent's job never holds an OIDC token (`context` fetches the prompt, `agent` runs the action, `report` posts the result); the prompt never travels in dispatch inputs. Per step, `platform/procedures/<step>.md` prefixes the prompt and `<step>.schema.json` becomes `--json-schema` (platform commit, ADR-0054). The profile (`platform/executor/profile.json`, merged per step with CODEOWNERS edit denies by `scripts/executor-profile.mjs`) is installed as managed settings, so only its permission rules apply and project hooks and MCP servers are off. The action's human-actor check allows only the App's bot (`allowed_bots`). Sandbox and network allowlist come with Bash in M1.8: Build + gate, which must also keep the model credential out of Bash's reach (Read denies don't stop `cat /proc/self/environ`).
- **Ticket context for agents** (all executors): the dispatch request carries the ticket snapshot (title, body, acceptance criteria, assumptions, answered questions). In M1: First end-to-end flow, that snapshot plus the callback on its own ticket is all an agent gets. From M2: Multi-project in parallel, agents that need more call the API/MCP read-only, scoped to that ticket's project, authenticated the same way (OIDC for Actions runs; a per-run token minted at dispatch for non-Actions executors).
- **OpenCode**: reusable Actions workflow running OpenCode with a per-project OpenRouter key; default harness for non-Claude models. Same callback auth as Claude Code.
- **Jules**: REST API (`sessions`, `activities`, `approvePlan`, `sendMessage`), configured to open a PR on completion. Completion is detected via the PR webhook (§7.1); `activities` are read on demand (watchdog, run detail view), not polled.
- **Direct**: in-process OpenRouter calls for single-call steps (sizing, question drafting where non-agentic, digests, scout analysis).

### 7.3 Skills (platform plugin, versioned) — the devkit
`/ideate`, `/refine`, `/spec`, `/plan-story`, `/build`, `/review`, `/security-review` (per PR), `/threat-model` (system review), `/verify`, `/scout-models`, (later `/digest`).
Substance lives in shared procedure docs (`docs/agent/*.md`) so non-Claude harnesses use the same knowledge; Claude skills/subagents are thin wrappers. Subagents with least-privilege tools: researcher (read-only), designer, critic (read-only), security reviewer (read-only, no shell or network), test-writer, implementer, verifier (run, no edit).

**Build runs prove their work (ADR-0040):** `/build` runs the project's lint/typecheck/test/build commands (listed in its `AGENTS.md`) and puts the results in the run summary; bug tickets commit a failing test first and don't change it afterwards; the verifier does a fresh-context final check.

**Agent evals (ADR-0040):** procedures, skills and agent rules are tested like code. Each case is an input (diff, ticket) plus deterministic checks on the structured output. The `agent-evals` check runs the suite when `platform/procedures/**`, `AGENTS.md`, `template/AGENTS.md.template` or `.claude/**` change and fails below the pass-rate threshold. Every escaped bug or reverted agent PR adds a case.

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
- **Phone** (M7: Mobile, ADR-0052): the same SPA installed from Safari as a web app, phone layout for the inbox, ticket detail, releases and the quota banner; push notifications deep-link to the item; answer, approve plan or PR, promote, pause dispatch from the phone.
- **Quota & spend** (per provider gauges with reset times; paid spend vs caps; persistent banner on warn/pause).
- **Projects** (list, config, policy overrides).
- **Tickets** — M1: list view grouped by stage, ticket detail with history and linked runs/PRs/cost, create/edit. M2: filter and group by project. Drag-and-drop (dnd-kit): built early (AI-16). M5: epic grouping, overrides editing.
- **Run detail** — M1: run summary inside ticket detail. M5: dedicated screen (metadata, cost, outcome, links out to Action log / Jules session / PR).
- **Config** (providers, harnesses, models, tiers, policies; audit log with revert; pending approvals).
- **Releases** (dev status, promote to prod, rollback).
- **Dashboards** — M5 (ADR-0045): delivery (tickets by stage over time, lead time, rework, CI green on first try, review blockers), cost, quota and tokens per run and step over time (ADR-0046), per project and overall; aggregation queries + shadcn charts. DORA metrics from M6.

**Design (M5, ADR-0045):** `apps/web/design.md` + shadcn theme tokens are the design source of truth that agents and design skills read. Design skills are pluggable per project (custom-skill context source, §7.6); Hallmark is the first candidate, trialled on one screen. Visual checks: Playwright screenshots + `sloplint --render` (non-blocking).
API client generated from OpenAPI.

**Built in M1.3: UI: tickets + inbox:**
- Routes: `/` Needs-you inbox; `/projects`; `/p/:projectId` tickets in one column per stage; `/p/:projectId/t/:ticketRef` detail (ref = key, e.g. `AI-2`; an id or wrong project switches to the canonical URL).
- Detail (`/p/<project>/t/<KEY>`; old id URLs redirect): edit fields (saves send `ifUpdatedAt`; a 409 conflict asks Andy to reload), Definition of Ready from `/readiness`, history with comments, the ticket's questions, and "Ask a question…".
- Moves: one button per move in `TRANSITIONS` (`packages/domain`), plus "Force move…" to any other stage (skips the rules; recorded in history). Board drag-and-drop (mouse, touch, keyboard): allowed column = normal move, else forced (not onto Cancelled). "Cancel ticket…" (optional reason), Archive/Unarchive, board "Show archived" toggle. The API enforces rules; errors show inline.
- Client: `openapi-fetch` typed by `apps/web/src/lib/api.gen.ts`, generated in-process from `createApp`'s OpenAPI document (`pnpm --filter @andy/web gen:api`); a test fails when it is stale. Every write refetches all queries (one user, small data).
- Untrusted text renders as plain text (no HTML or markdown).
- Tests render the UI against the in-process API (`createApp` + fakes); browser e2e later.
- Not yet: PR/cost panels, the kill switch's Needs-you item.

**Built in M1.19: GitHub App setup from the UI:** `/settings/github` (connect, install link, installed repos) and `/settings/github/callback`; the new-project form suggests installed repos.

### 7.6 Context sources (ADR-0033, ADR-0053)
Product and domain knowledge for agents, pluggable per project, behind a `ContextSource` port. Kinds: **markdown docs** in the repo (first), MCP servers such as Notion (later), custom skills such as a design skill reading `design.md` (ADR-0045, M5).

**Project brief** (ADR-0053, M2): `docs/product/brief.md` (idea, users, vision, goals, architectural expectations, open questions), written by one onboarding interview from the `/onboard` skill (MCP) or the UI's new-project flow, both calling the API that opens it as a PR. Refine and plan raise a question when a ticket contradicts it; the build updates it in the same PR when Andy picks the brief. Ideate and refine read all of it, plan and build the expectations, reviews the goals.

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
docs/product/brief.md             # project brief (ADR-0053) + further product docs
docs/security/threat-model.md     # living threat model + open risks (§9.1)
specs/NNN-name/{design.md, tech-design.md, tasks.md, stories/*.md, mockups/}
.github/workflows/                # thin callers → platform composite actions, pinned by SHA (ADR-0038)
.andy/baseline.json               # baseline version (andy-intelligence commit) this repo is on
CODEOWNERS                        # `*` requests Andy's review (ADR-0042); further lines = always-gated paths
infra/                            # Terraform: dev/prod Cloud Run, Cloud Deploy pipeline, read-only agent SAs
```
**Required CI checks** on `main`: tests, lint, typecheck, protected-path check, secret scan, security scans and security-review agent (§9.1), "PR references a ticket" (ticket key in branch name or PR body, verified against the control-plane API). These enforce rules for every agent regardless of harness.

Onboarding a project = UI/MCP "Add project" → onboarding interview → brief PR (ADR-0053) → bootstrap (applies the project baseline, §8.1; until then `platform/baseline/baseline.mjs onboard`, runbook `docs/runbooks/onboard-a-repo.md`: branch ruleset, repo settings, labels, template files, secrets refs, App install check, Terraform PR for GCP) → Andy approves Terraform PR.

### 8.1 Project baseline (ADR-0031)

Every guardrail built in this repo is packaged so each managed project gets it the same way, and this repo is configured from the same baseline. Built in M1.16: Project baseline v1. **Every slice that adds or changes a guardrail updates this table in the same PR.**

Carried by (ADR-0038): **A** = composite action in `platform/actions/`; managed repos get this repo's caller workflow with the action pinned to a commit SHA · **M** = managed file (kept identical; listed in `platform/baseline/manifest.json`) · **S** = seed file, copied once from `template/` · **G** = GitHub config in `platform/baseline/github/`, applied by `platform/baseline/baseline.mjs` · **TF** = Terraform module in `infra/modules/` · **RB** = runbook step (secrets).

Third-party action pins inside `platform/actions/` are bumped by this repo's Dependabot (`/platform/actions/*`); managed repos get them through the baseline pin. Drift: `baseline.mjs check <repo>` (Andy, local, everything); the weekly system security review checks labels and ruleset (its token can't read the rest).

| Guardrail | ADR | Source in this repo | Carried by | Status |
|---|---|---|---|---|
| Lint, typecheck, test, build | 0022 | `ci.yml` (`check`) → `platform/actions/ci-check` | A | carried (M1.16) |
| Firestore adapter contract suites on the emulator (path-gated) | 0034, 0048 | `firestore-suite.yml` | — | control plane only (no managed project has Firestore adapters yet) |
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
| Agent rules; docs ship with the change | 0022 | `template/AGENTS.md.template` | S | carried (M1.16) |
| Threat model seed | 0025 | `template/docs/security/threat-model.md` | S | carried (M1.16) |
| Public-repo hygiene (`.gitignore`: tfvars, state, `.env*`) | 0015 | `template/gitignore.lines` | M (lines) | carried (M1.16) |
| `main` ruleset: PR required (squash), no force push/deletion, required checks, code scanning (CodeQL, high or higher) | 0025 | `github/ruleset-main.json` | G | carried (M1.16) |
| Merge settings: squash only, delete branch on merge, auto-merge allowed (Dependabot, ADR-0042; agent PRs through the review gate from M1.8: Build + gate, ADR-0050) | 0022, 0042, 0050 | `github/repo.json` | G | carried (M1.16; auto-merge from ADR-0042) |
| Agent PR policies `autoMerge` (default S and M) and `planApproval` (default none); protected paths in CODEOWNERS always go to Andy | 0050 | planned: M1.8: Build + gate (`template/.github/CODEOWNERS` gets the protected paths) | S, G | not built |
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
| Context budget: agent-loaded docs within size budgets (`context-budget.json`; default `AGENTS.md`/`CLAUDE.md` ≤ 200 lines) | 0046 | `scripts/context-budget.mjs` in `platform/actions/ci-check` | A | carried (next baseline tag) |
| Review agents: lockfiles out of the diff (code first, 120 KB cap with truncation note); lockfile sources must be the npm registry with integrity | 0046 | `platform/actions/agent-review-prepare`; `scripts/lockfile-sources.mjs` in `platform/actions/ci-check` | A | carried (next baseline tag) |
| Agent evals (`agent-evals` check) | 0040 | planned: M1.17: Agent evals v1 | A | not built |
| Executor permission profile (headless Claude Code) | 0040, 0051 | `platform/executor/profile.json` + `scripts/executor-profile.mjs`, installed by the reusable `claude-executor.yml` | — | built (M1.6a); managed repos call the reusable workflow from M2: Multi-project in parallel |
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
- **Backups** (§10.3): before a risky deploy, run a manual export (runbook); restore drill once per milestone.
- A separate control-plane dev environment comes last (§12 Later: Control plane in dev + prod); moving data then = export/import + the same upgraders.

## 11. Technology choices

| Concern | Choice |
|---|---|
| Language / repo | TypeScript, pnpm workspaces monorepo |
| API | Node HTTP framework with Zod-based OpenAPI generation (builder to propose; e.g., Hono + zod-openapi) |
| MCP | Official MCP TypeScript SDK, Streamable HTTP, OAuth |
| DB | Firestore (Native mode, default database, us-central1; free tier) with Zod-validated converters; no migrations (ADR-0017) |
| UI | React, Vite, shadcn/ui, Tailwind, TanStack Router/Query/Table, dnd-kit (board drag-and-drop), shadcn charts; OpenAPI-generated client |
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
| M5 | Epics + story board | Epics; epic grouping on the board; config editing; UI design system and dashboards |
| M6 | Dev → prod releases | Per-project dev/prod deploys, verification, one-click promote, DORA metrics |
| M7 | Mobile | The UI installed on Andy's phone with push notifications; answer, approve, promote and pause from anywhere |

**Order (ADR-0050, ADR-0052):** M0 → M1 → M2 → **M5 → M6 → M7 → M3 → M4**. Claude-only through M6: Jules (M3) and paid models with the scout (M4) come after releases. IDs keep their meaning.

**Renumbered 2026-11-01 (ADR-0035):** M2: Multi-project in parallel was inserted. ADRs written before then mean M3 by "M2", M4 by "M3", M5 by "M4" and M6 by "M5".

**Naming:** always write a milestone or slice as `ID: title`, e.g. "M1.2: Ticket core". The ID alone means nothing to a reader.

### How milestones are built: slices
**With itself (ADR-0047):** 1. track slices as tickets in project `AI` now; 2. S tickets built by the control plane once M1: First end-to-end flow is done; 3. most work, including parallel waves, once M2: Multi-project in parallel is done. Trust-boundary work (auth, IAM, Terraform, workflows, review gates) and deploy-breaking changes stay in interactive sessions.

Each milestone is delivered as **slices**. A slice:
- is one PR, branched from the latest `main` after its dependencies have merged — no stacked PRs;
- has its own **Done when** that Andy can check in a few minutes;
- is sized so one agent session can finish it (S ≈ hours, M ≈ a session, L = split it);
- declares its dependencies, so independent slices can run in parallel sessions/worktrees.

Slice status lives in tickets in project `AI` (ADR-0047 phase 1, since 2026-11-04); until the Needs-you inbox can hold them, `docs/build-log.md` maps slices to tickets and keeps pending decisions and blockers (history in `docs/build-log/`). The milestone's **Done when** is checked only after all its slices merge.

### M0: Foundations: repo, sign-in, GCP infra
Repo scaffold, contracts package, Terraform for control-plane GCP project (plan reviewed by Andy), Firestore database (server-only access), auth (UI + API allow-list), CI, ADRs for decisions in this doc.
**Done when:** Andy can sign in to an empty UI on Cloud Run; unauthorized users are rejected; `terraform plan` is clean.

### M1: First end-to-end flow: ticket → PR with Claude
**Done when:** From Claude desktop, Andy creates a ticket → agent asks refinement questions → Andy answers via MCP → ticket reaches Ready → Claude plans and builds (Sonnet for S, Opus for M/L) and reports its verification output → PR opens → it merges on its own (S/M) or Andy merges (L) → run shows in the UI with cost/quota.

**Explicitly not in M1: First end-to-end flow:** epics, dedicated run-detail screen, agent read access to API/MCP, routing beyond Claude Code (model per size only).

**Merged slices** (scope and Done when moved to [`history/m1-merged-slices.md`](history/m1-merged-slices.md), ADR-0046): M1.0: Docs sync; M1.1: MCP OAuth spike; M1.2: Ticket core; M1.3: UI: tickets + inbox; M1.4: MCP core tools; M1.5: GitHub App + project registration; M1.19: GitHub App setup from the UI; M1.20: Custom domain; M1.10: Security review automation; M1.11: Adversarial PR review; M1.12: Local quality gates; M1.13: GCP cost guardrails; M1.14: Cost kill switch; M1.16: Project baseline v1; M1.15: Usage alerts; M1.7: Refinement.

| Slice | Scope | Size | Depends on | Done when |
|---|---|---|---|---|
| **M1.6: Claude Code executor** | **6a:** reusable workflow running the real `claude-code-action`; `workflow_dispatch` from the App with run ID; OIDC-authenticated callback; Run records; the executor takes the credential kind from the route's `Provider` (subscription token now, API key later, ADR-0050); **permission profile** for headless runs (§7.2, ADR-0040); threat model gets ticket text as untrusted input. First verify open question 5 (headless billing). **6b:** Cloud Tasks watchdog at deadline; one automatic retry then Needs-you. | L (6a dispatch+callback, 6b watchdog+retry) | M1.5: GitHub App + project registration, M1.19: GitHub App setup from the UI | 6a: a run on a seeded ticket dispatches, calls back with its report, and completes; a run that tries to read `.env` or edit a CODEOWNERS path is refused. 6b (built): a killed run is caught by the watchdog and flagged |
| **M1.8: Build + gate** | Dispatcher picks Ready tickets; model per size (Sonnet for S, Opus for M/L, overridable per ticket); `build` run starts read-only and writes its plan (files, order of work, tests, riskiest step, rejected alternatives), stops there if the project's `planApproval` policy applies (approve/reject with a reason from UI and MCP), then opens a PR titled `<KEY>: <ticket title>` whose description starts with a link to the ticket (`<PUBLIC_URL>/p/<project>/t/<KEY>`), with a structured summary (ticket key, plan, deviations, verification output); bug tickets commit a failing test first; verifier subagent; gate vetoes a PR without verification output; adversarial procedure adds the acceptance-criteria + plan pass and the nit cap of 5; **auto-merge** per the project's `autoMerge` policy (default S and M) when every required check and both review agents pass, done by the control plane with the App token (a bot actor: no deploy of this repo), vetoed PRs go to Andy; before it is on: the executor's permission profile proven live with a counted denial (AI-12), protected paths in CODEOWNERS (this repo and the baseline seed), threat-model R21 completed, §8.1 row for `autoMerge` and `planApproval`; project `AI` stays `autoMerge: none` until the control plane has a safe deploy path (ADR-0050); `would_auto_merge` recorded; outcome set from merge/close webhook; cost estimate and metrics (CI green on first try, review blockers, Andy's commits before merge, rework) on the Run (ADR-0040). | M | M1.7: Refinement, M1.16: Project baseline v1 | Ready S ticket → PR with plan and verification output → merges on its own → ticket advances; with `autoMerge: none` the PR waits for Andy; with `planApproval: all` the run stops after the plan and continues on approval; Run shows cost estimate, outcome and metrics; a PR summary without verification output is vetoed |
| **M1.9: Quota capture** | Timeboxed, best-effort. Capture claude-sub `rate_limits` from runs if available headless; otherwise readings stay **unknown** per policy. UI banner on warn/pause/unknown. | S | M1.8: Build + gate | Gauge shows a reading or "unknown"; banner appears at thresholds (test with seeded readings) |
| **M1.17: Agent evals v1** | Eval suite for the agent configuration (ADR-0040): `Evaluator` port + fake + contract suite; cases = input (diff, ticket) + deterministic checks on structured output; seed cases from the review demos (PR #12, PR #22: planted bugs must get a high/critical or `blocker`), clean diffs (no blocker) and the first real runs' refine and build outputs; required `agent-evals` check that runs when `platform/procedures/**`, `AGENTS.md`, `template/AGENTS.md.template` or `.claude/**` change, passes without running otherwise, fails below the pass-rate threshold; capped cases/turns per run (subscription quota). Pick the tool first (promptfoo is the candidate). Each case records input tokens; a token jump fails like a pass-rate drop (ADR-0046). | M | M1.8: Build + gate | A PR that weakens the adversarial procedure (e.g. drops the failing-scenario rule) fails `agent-evals`; reverting it passes; a code-only PR skips the run |

Waves (ADR-0050): M1.6a → M1.7 → M1.8 → M1.6b ‖ M1.17: Agent evals v1 ‖ M1.9: Quota capture. M1.18: Plan step is folded into M1.8.

### M2: Multi-project in parallel
Andy builds several systems at once (ADR-0035). Onboard N projects via M1.5: GitHub App + project registration and M1.16: Project baseline v1 (per-PR reviews, local gates, weekly system review: §9.1, §4.5, §10.2); **stories by project** in the UI and MCP (`list_projects`, per-project lists, inbox grouped by project); concurrent runs across projects with explicit caps (max runs per project and globally, ADR-0028); quota-aware dispatch so parallel runs keep the subscription reserves (§5); agent read access to API/MCP scoped per project; coordination of parallel work (ADR-0047: conflict-aware dispatch, sync runs, merge queue, collision-free IDs, in-flight view, cross-project dependencies); **onboarding interview and project brief** (ADR-0053); dispatch also capped by PRs waiting for Andy (review capacity), repeated review findings become a pending `ConfigChange` to `AGENTS.md` or a procedure (ADR-0040); **ideation** (ADR-0050): `/ideate` from Claude desktop, Claude Code or the UI turns an idea into an epic ticket in its project with a `specs/` draft in the repo (§7.3, §8). Slice at milestone start.

### M3: Add Jules + model routing
After M6: Dev → prod releases (ADR-0050). Jules adapter (completion via PR webhook); freeze `Executor` contract (two adapters pass contract tests); harness/provider/model/tier config with compatibility rules; cross-model review; google-sub quota (task counting) and reserves. Slice at milestone start.

### M4: Paid models + spend caps
After M3: Add Jules + model routing (ADR-0050): the spend-optimization goal, started when the Claude plan is cut or cheaper models are wanted. OpenCode executor via Actions; OpenRouter direct-call gateway for single-call steps; a capped API-key Claude provider; global and per-project caps with hard stops; quota-aware route fallback with 20% reserves; weekly model scout producing pending tier changes. Slice at milestone start.

### M5: Epics + story board
Epics with child tickets and dependencies; just-in-time re-planning; config editing and audit/revert in UI and MCP; epic grouping on the board; dedicated run-detail screen; UI design system (`design.md` + tokens), pluggable design skills with a Hallmark trial, Playwright screenshot checks, and a Dashboards screen (ADR-0045) including tokens per run and per step (ADR-0046); **overnight runs** (ADR-0049: launch step with batched answers and plan approvals, one-night epic branch, night budget and stop time, morning report as a Needs-you item). Slice at milestone start.

### M6: Dev → prod releases
Environments as per-project policy (ADR-0050): MVPs get one prod project + PR previews; dev + prod when a project opts in. Project template Terraform + Cloud Deploy dev→prod, with a budget and caps per project (§10.1); dev deploy + verification (Playwright/API tests + verification agent); promote/rollback from UI and MCP; release notes; DORA metrics (deploy frequency, lead time, change failure rate, time to restore; ADR-0040). Slice at milestone start.

### M7: Mobile
The control-plane UI as an installable web app with push (ADR-0052 has the design): verify Web Push on Andy's iPhone first; `web-push` `Notifier` adapter and `PushSubscriptionStore` port; notice types with deep links, caps, quiet hours; phone layout for the inbox, ticket detail, releases; answer, approve, promote, pause from the phone; no agent-written text in a notification. Slice at milestone start.

### Later (explicitly deferred)
After M6: Dev → prod releases: **per-project custom domains**. (The control plane's own domain moved up to M1.20: Custom domain, ADR-0044.)

**Control plane in dev + prod** (last; Andy, 2026-11-03): deploy the control plane itself to separate environments, reusing M6: Dev → prod releases' pipeline. Terraform roots parameterized per environment (GCP project ID, state prefix, domain as settings, not defaults); one image built once and promoted dev → prod; separate Firebase sign-in, GitHub App, MCP connector URL and budget per environment; data moved by export/import with the same upgraders (§10.4).

**Devkit standalone + local mode** (ADR-0032): phase 1 devkit in Claude Code with markdown tickets; phase 2 full control plane locally. Designed after M1: First end-to-end flow.

**Context sources** (ADR-0033, §7.6): `ContextSource` port, project manifest, MCP and skill sources (Notion first, when wanted). Designed after M1: First end-to-end flow.

Prod monitoring agent and alert→ticket flow; write-approval execution; model-based risk scoring; email/Slack digests; transcript storage; BigQuery analytics; promptfoo red-team; read-only agent that triages a failed `main` build (ADR-0040); Cloud Run Jobs executors; additional harnesses (Antigravity CLI, Codex).

---

## 13. Open questions

Resolved in M0: GitHub home (personal account, public repos — ADR-0003); GCP project `andy-intelligence-512400` in `us-central1` (ADR-0007); Firestore (ADR-0017); default run.app URL (ADR-0007; replaced by `ai.andybernhagen.com` in M1.20: Custom domain, ADR-0044); work tracking native (ADR-0016).

Resolved in M1.0: Docs sync (ADR-0018 – ADR-0024): Jules completion detection (PR webhook + deadline watchdog); agent callback auth (GitHub Actions OIDC); rollups (aggregation queries); M1 scope cuts and slicing; docs upkeep; contract suites for every port (ADR-0012 rejected).

Remaining:

2. Naming convention for per-project dev/prod GCP projects (needed by M6: Dev → prod releases).
5. ~~Claude plan (Pro vs Max) — affects automated-run budget~~ — **decided (ADR-0050)**: automated runs use Andy's subscription for now, behind a `Provider` so a capped API key is configuration later. Verified in M1.6a (ADR-0051): Anthropic's docs bill OAuth-token runs to the subscription and document `claude setup-token` for CI; plan limits assume ordinary individual use.
6. Google plan (AI Pro vs Ultra) and current Jules daily task quota.
7. OpenRouter: account exists? initial monthly/daily caps?
8. ~~First real side project to onboard in M1: First end-to-end flow~~ — **answered in M1.5: GitHub App + project registration**: andy-intelligence itself is project #1 (ADR-0041); side projects in M2: Multi-project in parallel.
9. ~~Claude custom-connector OAuth mechanism currently supported (dynamic client registration vs static client)~~ — **answered by M1.1: MCP OAuth spike**: CIMD against our own authorization server (ADR-0039).
10. Whether the Jules GitHub integration or the Jules REST API should be the dispatch path (REST preferred for run tracking; must support auto-PR creation for the completion signal).
11. Local mode design (ADR-0032): markdown ticket format, local executor (Claude Code CLI) and its trust boundary, local storage/queue/auth adapters, devkit packaging and versioning. Due after M1: First end-to-end flow.
12. Context sources design (ADR-0033): markdown kind **answered by ADR-0053** (brief, interview, step mapping). Port shape and MCP registration: after M2: Multi-project in parallel.

---

## 14. Documentation

Docs are part of the change, not a follow-up. Every slice PR updates the docs its change affects; the reviewer (Andy, or the review gate for managed projects) treats a stale doc like a failing test.

**Style:** short, plain, and readable cold — by someone with no chat history. Lead with the point. Prefer tables and lists to prose. Define a term or ID where it's used. Cut anything that doesn't change what the reader does.

| Doc | Owns | Update when |
|---|---|---|
| `context-budget.json` | Size budgets for agent-loaded docs, checked in CI (ADR-0046) | A budgeted doc is added; never raise a number without Andy |
| `README.md` | What the repo is; **How it works today** (what's built, how to use it, how it works; one screen, ADR-0040); how to develop/run/test, layout table, links to the docs below | Commands, env vars, packages/apps, or layout change; a feature, component or way of using the system is added or changed |
| `docs/architecture/ARCHITECTURE.md` | Current target design and milestone/slice plan (this doc) | Design, scope, or plan changes. No revision counter: `git log` is its history (ADR-0046). Never let it describe something the code contradicts. |
| `docs/architecture/adr/NNNN-*.md` | Why a decision was made (MADR) | Any architecture decision or deviation. ADR bodies are immutable; to change a decision write a new ADR and update the old one's `status` (`superseded by` / `amended by`). |
| `docs/architecture/adr/README.md` | One line per ADR: number, decision, status (ADR-0046) | With every new ADR or status change (a test checks) |
| `docs/build-log.md` | Slice → ticket map, decisions pending, blockers (≤ 1 page, ADR-0046); slice status is in tickets in project `AI` (ADR-0047 phase 1) | When a decision or blocker changes. What happened goes in a new file per entry, `docs/build-log/YYYY-MM-DD-<slug>.md` (never append to a shared file). |
| `docs/runbooks/*.md` | Steps Andy runs by hand (setup, secrets, apply, release) | Any manual step is added, changed, or removed |
| `docs/security/threat-model.md` | Assets, trust boundaries, threats, mitigations, open risks | A trust boundary, entry point, credential, or IAM grant is added or changed; after each system security review |
| `docs/BUILD-PROMPT.md` | How a building agent behaves | Operating rules change |
| `AGENTS.md` (`CLAUDE.md` → symlink) | Short, always-loaded rules for agents working in the repo; nested `AGENTS.md` in `infra/`, `.github/`, `packages/contracts/` load only when working there (ADR-0046) | Rules or doc map change |
| §8.1 Project baseline inventory | Every guardrail and how managed projects get it | A quality, security, cost or scaling guardrail is added or changed |
| Package/app `README.md` | Only when a package has setup or usage the root README can't cover in a line | That package's usage changes |

Managed projects get the same rule through the template (§8): `docs/features.md` is updated on merge, `docs/architecture/overview.md` when the design changes, ADRs for decisions.

The claude.ai Project holds reference copies of `ARCHITECTURE.md` and `BUILD-PROMPT.md` for planning conversations. **The repo is canonical**; refresh the Project copies when `ARCHITECTURE.md` changes on `main`.
