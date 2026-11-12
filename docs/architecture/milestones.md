# andy-intelligence — Milestones and slices

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 12. Milestones (v1.x)

### How milestones are built: slices
**With itself (ADR-0047):** 1. track slices as tickets in project `AI` now; 2. S tickets built by the control plane once M1: First end-to-end flow is done; 3. most work, including parallel waves, once M5: Multi-project in parallel is done. Trust-boundary work (auth, IAM, Terraform, workflows, review gates) and deploy-breaking changes stay in interactive sessions.

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

**Merged slices** (scope and Done when moved to [`history/m1-merged-slices.md`](history/m1-merged-slices.md), ADR-0046): M1.0: Docs sync; M1.1: MCP OAuth spike; M1.2: Ticket core; M1.3: UI: tickets + inbox; M1.4: MCP core tools; M1.5: GitHub App + project registration; M1.19: GitHub App setup from the UI; M1.20: Custom domain; M1.10: Security review automation; M1.11: Adversarial PR review; M1.12: Local quality gates; M1.13: GCP cost guardrails; M1.14: Cost kill switch; M1.16: Project baseline v1; M1.15: Usage alerts; M1.7: Refinement; M1.6: Claude Code executor.

| Slice | Scope | Size | Depends on | Done when |
|---|---|---|---|---|
| **M1.8: Build + gate** | **Status:** 8a built in two PRs: dispatcher, build step and PR (ADR-0063), then `planApproval` (ADR-0050); 8b (gate, auto-merge, metrics) next. Dispatcher picks Ready tickets; model per size (Sonnet for S, Opus for M/L, overridable per ticket); `build` run starts read-only and writes its plan (files, order of work, tests, riskiest step, rejected alternatives), stops there if the project's `planApproval` policy applies (approve/reject with a reason from UI and MCP), then opens a PR titled `<KEY>: <ticket title>` whose description starts with a link to the ticket (`<PUBLIC_URL>/p/<project>/t/<KEY>`), with a structured summary (ticket key, plan, deviations, verification output); bug tickets commit a failing test first; verifier subagent; gate vetoes a PR without verification output; adversarial procedure adds the acceptance-criteria + plan pass and the nit cap of 5; **auto-merge** per the project's `autoMerge` policy (default S and M) when every required check and both review agents pass, done by the control plane with the App token (a bot actor: no deploy of this repo), vetoed PRs go to Andy; before it is on: the executor's permission profile proven live with a counted denial (AI-12), protected paths in CODEOWNERS (this repo and the baseline seed), threat-model R21 completed, §8.1 row for `autoMerge` and `planApproval`; project `AI` stays `autoMerge: none` until the control plane has a safe deploy path (ADR-0050); `would_auto_merge` recorded; outcome set from merge/close webhook; cost estimate and metrics (CI green on first try, review blockers, Andy's commits before merge, rework) on the Run (ADR-0040). | M | M1.7: Refinement, M1.16: Project baseline v1 | Ready S ticket → PR with plan and verification output → merges on its own → ticket advances; with `autoMerge: none` the PR waits for Andy; with `planApproval: all` the run stops after the plan and continues on approval; Run shows cost estimate, outcome and metrics; a PR summary without verification output is vetoed |
| **M1.9: Quota capture** | Timeboxed, best-effort. Capture claude-sub `rate_limits` from runs if available headless; otherwise readings stay **unknown** per policy. UI banner on warn/pause/unknown. | S | M1.8: Build + gate | Gauge shows a reading or "unknown"; banner appears at thresholds (test with seeded readings) |
| **M1.17: Agent evals v1** | Eval suite for the agent configuration (ADR-0040): `Evaluator` port + fake + contract suite; cases = input (diff, ticket) + deterministic checks on structured output; seed cases from the review demos (PR #12, PR #22: planted bugs must get a high/critical or `blocker`), clean diffs (no blocker) and the first real runs' refine and build outputs; required `agent-evals` check that runs when `platform/procedures/**`, `AGENTS.md`, `template/AGENTS.md.template` or `.claude/**` change, passes without running otherwise, fails below the pass-rate threshold; capped cases/turns per run (subscription quota). Tool: an in-repo runner (ADR-0086; promptfoo rejected). Each case records input tokens; a token jump fails like a pass-rate drop (ADR-0046). | M | M1.8: Build + gate | A PR that weakens the adversarial procedure (e.g. drops the failing-scenario rule) fails `agent-evals`; reverting it passes; a code-only PR skips the run |

Waves (ADR-0050): M1.6a → M1.7 → M1.8 → M1.6b ‖ M1.17: Agent evals v1 ‖ M1.9: Quota capture. M1.18: Plan step is folded into M1.8. M1 closes with ticket model v2 (ADR-0058) and M1.8 as 8a then 8b; M1.9 and M1.17 belong to M2 (ADR-0060).

### M2: Self-hosting: andy-intelligence builds itself
Scope and "Done when": ADR-0060. Safe deploy and rollback, then `autoMerge` on for project `AI`; several runs at once in a project (ADR-0047) under Andy's dial, caps and pause; M1.9: Quota capture; M1.17: Agent evals v1; email notifications; cost per ticket; a daily digest.

### M3: New UI and MCP
The UX foundation (ADR-0059), ticket-organizing MCP tools and AI-19: One permission function (ADR-0060).

**AI-44: Local executor** (ADR-0089): a runner on Andy's Mac polls the control plane and claims runs. Slice 1 is the design; slices 2 to 7 (setting and override, runner registration, claim and lease, runner CLI, local publish, runbook) are the ADR's table.

### M4: Epics + story board
Epics with child tickets and dependencies; just-in-time re-planning; config editing and audit/revert in UI and MCP; epic grouping on the board; dedicated run-detail screen; pluggable design skills with a Hallmark trial and a Dashboards screen (ADR-0045; `design.md` earlier, ADR-0059) including tokens per run and per step (ADR-0046); **overnight runs** (ADR-0049: launch step with batched answers and plan approvals, one-night epic branch, night budget and stop time, morning report as a Needs-you item).

**Slices** (AI-80, 2026-11-11): 23 tickets under AI-84: M4: Epics + story board; the table (scope, size, depends on, risk, Done when, ticket) and batch order are in [`m4-slices.md`](m4-slices.md).

### M5: Multi-project in parallel
Andy builds several systems at once (ADR-0035). Onboard N projects via M1.5: GitHub App + project registration and M1.16: Project baseline v1 (per-PR reviews, local gates, weekly system review: §9.1, §4.5, §10.2); **stories by project** in the UI and MCP (`list_projects`, per-project lists, inbox grouped by project); concurrent runs across projects with explicit caps (max runs per project and globally, ADR-0028); quota-aware dispatch so parallel runs keep the subscription reserves (§5); agent read access to API/MCP scoped per project; coordination across projects (ADR-0047: merge queue, cross-project dependencies; the single-project parts are in M2); **onboarding interview and project brief** (ADR-0053); repeated review findings become a pending `ConfigChange` to `AGENTS.md` or a procedure (ADR-0040); **ideation** (ADR-0050): `/ideate` from Claude desktop, Claude Code or the UI turns an idea into an epic ticket in its project with a `specs/` draft in the repo (§7.3, §8); spike tickets (ADR-0058). Slice at milestone start.

### M6: Dev → prod releases
Environments as per-project policy (ADR-0050): MVPs get one prod project + PR previews; dev + prod when a project opts in. Project template Terraform + Cloud Deploy dev→prod, with a budget and caps per project (§10.1); dev deploy + verification (Playwright/API tests + verification agent), which adds its own verification stage between Ready for review and Done, named then (ADR-0069); promote/rollback from UI and MCP; release notes; DORA metrics (deploy frequency, lead time, change failure rate, time to restore; ADR-0040). Slice at milestone start.

### M7: Mobile
The control-plane UI as an installable web app with push (ADR-0052 has the design): verify Web Push on Andy's iPhone first; `web-push` `Notifier` adapter and `PushSubscriptionStore` port; notice types with deep links, caps, quiet hours; phone layout for the inbox, ticket detail, releases; answer, approve, promote, pause from the phone; no agent-written text in a notification. Slice at milestone start.

### M8: Project members
Other users on a project with basic roles (AI-18). Designed at milestone start.

### M9: Add Jules + model routing
After M6: Dev → prod releases (ADR-0050). Jules adapter (completion via PR webhook); freeze `Executor` contract (two adapters pass contract tests); harness/provider/model/tier config with compatibility rules; cross-model review; google-sub quota (task counting) and reserves. Slice at milestone start.

### M10: Paid models + spend caps
After M9: Add Jules + model routing (ADR-0050): the spend-optimization goal, started when the Claude plan is cut or cheaper models are wanted. OpenCode executor via Actions; OpenRouter direct-call gateway for single-call steps; a capped API-key Claude provider; global and per-project caps with hard stops; quota-aware route fallback with 20% reserves; weekly model scout producing pending tier changes. Slice at milestone start.

### Later (explicitly deferred)
After M6: Dev → prod releases: **per-project custom domains**. (The control plane's own domain moved up to M1.20: Custom domain, ADR-0044.)

**Control plane in dev + prod** (last; Andy, 2026-11-03): deploy the control plane itself to separate environments, reusing M6: Dev → prod releases' pipeline. Terraform roots parameterized per environment (GCP project ID, state prefix, domain as settings, not defaults); one image built once and promoted dev → prod; separate Firebase sign-in, GitHub App, MCP connector URL and budget per environment; data moved by export/import with the same upgraders (§10.4).

**Devkit standalone + local mode** (ADR-0032): phase 1 devkit in Claude Code with markdown tickets; phase 2 full control plane locally. Designed after M1: First end-to-end flow; the local executor in ADR-0089.

**Context sources** (ADR-0033, §7.6): `ContextSource` port, project manifest, MCP and skill sources (Notion first, when wanted). Designed after M1: First end-to-end flow.

Prod monitoring agent and alert→ticket flow; write-approval execution; model-based risk scoring; email/Slack digests; transcript storage; BigQuery analytics; promptfoo red-team; read-only agent that triages a failed `main` build (ADR-0040); Cloud Run Jobs executors; additional harnesses (Antigravity CLI, Codex).
