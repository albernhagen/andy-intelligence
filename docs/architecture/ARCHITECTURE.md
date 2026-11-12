---
title: andy-intelligence — Architecture & Vision
status: accepted (v1.x scope)
owner: Andy
---

# andy-intelligence — Architecture & Vision

A personal, single-tenant **control plane for agentic software development** across many side projects. It turns ideas into refined tickets, routes work to the right agent/model under cost and quota controls, ships to dev with self-verification, gives Andy a one-click release to prod, and keeps him informed through a single "Needs you" surface.

Enterprise-shaped (durable state, policy, gates, least privilege, audit, contract-first) but sized for one person.

**How to read this doc (ADR-0046: Context budget; ADR-0061: ARCHITECTURE split):** this file is the overview: design intent, one summary per section, the milestone table. Detail lives in one file per topic under `docs/architecture/`, with the same section numbers. Read your ticket, the summaries here, then only the topic files it needs. Detail changes go in the topic file; this file changes only when design intent, a component list or the milestone table changes.

| Section                                                                | File                                                                                                                               | Read when                                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| §1–3 Goals, principles, overview · §11 Technology · §13 Open questions | this file                                                                                                                          | New to the project, a change touches scope, adding a library, decisions pending |
| §4 Workflow (stages, DoR, refinement, epics, gate, release)            | [`workflow.md`](workflow.md)                                                                                                       | Ticket rules, pipeline, review gate                                             |
| §5 Domain model · §6 Ports                                             | [`domain-and-ports.md`](domain-and-ports.md)                                                                                       | Data model, contracts, adapters                                                 |
| §7.1 Control plane service (API, MCP, webhooks, runs)                  | [`api-and-mcp.md`](api-and-mcp.md)                                                                                                 | API, MCP tools, webhooks, run lifecycle                                         |
| §7.2 Executors                                                         | [`executors.md`](executors.md)                                                                                                     | Agent runs, permission profile                                                  |
| §7.3 Skills · §7.4 Model scout                                         | [`skills-and-scout.md`](skills-and-scout.md)                                                                                       | Procedures, skills, evals, devkit                                               |
| §7.5 UI                                                                | [`ui.md`](ui.md)                                                                                                                   | Screens, web client                                                             |
| §7.6 Context sources                                                   | [`context-sources.md`](context-sources.md)                                                                                         | Brief, product knowledge for agents                                             |
| §8 Template · §8.1 Baseline inventory                                  | [`template-and-baseline.md`](template-and-baseline.md)                                                                             | Managed-repo files or any guardrail                                             |
| §9 Security                                                            | [`security.md`](security.md)                                                                                                       | Auth, IAM, secrets, review agents                                               |
| §10 Observability and cost                                             | [`observability-and-cost.md`](observability-and-cost.md)                                                                           | Caps, alerts, local gates, data                                                 |
| §12 Milestones and slices                                              | table here; detail [`milestones.md`](milestones.md); merged M1 slices [`history/m1-merged-slices.md`](history/m1-merged-slices.md) | Every ticket: its milestone and slice row                                       |
| §14 Documentation                                                      | [`documentation.md`](documentation.md)                                                                                             | Which doc to update                                                             |

---

## 1. Goals and non-goals

### Goals (v1.x)

1. **Ideate with system context.** Design new features with knowledge of the current architecture and shipped features; outputs become markdown in the project repo.
2. **Ticketing from anywhere.** Create and refine work in the UI or conversationally from any MCP-capable AI tool (Claude desktop first).
3. **Mandatory refinement.** Every ticket gets a refinement pass in which agents ask Andy targeted questions before work starts.
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

A ticket moves Backlog → Ready → In progress → Ready for review → Done (or Cancelled; no Monitoring until M6, ADR-0069); refinement gets it to the Definition of Ready, a run builds it, a rule-based gate merges it. Detail: [`workflow.md`](workflow.md).

### 4.1 Stages (`ticket.stage`, shown as columns/groups in the UI)

The seven stages, their exit criteria, allowed moves (forward, re-refine, retry, rework; Andy forces, cancels, archives), PR events moving tickets, and Needs-you as a flag. [`workflow.md` §4.1](workflow.md#41-stages-ticketstage-shown-as-columnsgroups-in-the-ui)

### 4.2 Definition of Ready (per type)

Per type (feature, chore, bug): intent, criteria ("… shall …" for features), size with reason, dependencies, no open questions; epics need only intent; tier comes from size; checked by `checkDor` in `packages/domain`. [`workflow.md` §4.2](workflow.md#42-definition-of-ready-per-type-adr-0058)

### 4.3 Refinement and questions

Every ticket gets a refinement pass that asks Andy 1–5 structured questions; answers re-check the DoR; refine runs start on events (ADR-0054). [`workflow.md` §4.3](workflow.md#43-refinement-and-questions)

### 4.4 Epics

Child tickets with dependencies, vertical-slice stories merged to `main`, just-in-time re-planning, roll-ups. [`workflow.md` §4.4](workflow.md#44-epics)

### 4.5 Review gate (v1.x: rules only)

Hard vetoes send a PR to Andy; otherwise agent PRs auto-merge per `autoMerge`; Dependabot rules; adversarial and security review on every PR. [`workflow.md` §4.5](workflow.md#45-review-gate-v1x-rules-only)

### 4.6 Environments and release

Per-project dev/prod GCP projects, build once and promote by digest with Cloud Deploy, verification on dev, prod read-only for agents. [`workflow.md` §4.6](workflow.md#46-environments-and-release)

---

## 5. Domain model (Firestore documents)

Project, Ticket, TicketEvent, Question, Run, Provider, Harness, Model, Tier, Policy, QuotaReading, ConfigChange, Release, CodeHostEvent; Zod-validated on every read and write; rollups computed on read; configuration rules (global is the ceiling, projects narrow) and the default quota policy. Detail: [`domain-and-ports.md` §5](domain-and-ports.md#5-domain-model-firestore-documents)

## 6. Ports (contracts) and adapters

Every external dependency sits behind a port in `packages/contracts` with an in-memory fake and a shared contract suite (ADR-0023); the port table lists v1.x and later adapters; freeze `Executor` after two real adapters. Detail: [`domain-and-ports.md` §6](domain-and-ports.md#6-ports-contracts-and-adapters)

---

## 7. Components

One Cloud Run service (API, MCP, webhooks, pipeline, router, UI), executors on GitHub Actions and vendor APIs, a skills devkit, a weekly model scout, and per-project context sources.

### 7.1 Control plane service (Cloud Run)

Public URL `ai.andybernhagen.com`; REST API and remote MCP server (tools); GitHub webhook receiver; project registration and GitHub App setup; repo tokens for CI; agent runs, completion signals and the per-run watchdog; pipeline engine, router, scheduled jobs; the UI as a static SPA. Detail: [`api-and-mcp.md`](api-and-mcp.md)

### 7.2 Executors

Claude Code on Actions (permission profile, three-job workflow, OIDC callback), ticket context for agents, OpenCode, Jules and direct OpenRouter calls. Detail: [`executors.md`](executors.md)

### 7.3 Skills (platform plugin, versioned) — the devkit

Slash-command skills over vendor-neutral procedure docs, least-privilege subagents, build runs that prove their work, agent evals, the standalone devkit and deployment modes (ADR-0032). Detail: [`skills-and-scout.md` §7.3](skills-and-scout.md#73-skills-platform-plugin-versioned--the-devkit)

### 7.4 Model scout (weekly)

Reads model prices, releases and run outcomes, then proposes tier changes as a pending ConfigChange. Detail: [`skills-and-scout.md` §7.4](skills-and-scout.md#74-model-scout-weekly)

### 7.5 UI (React + Vite + shadcn/ui + Tailwind, TanStack Router/Query/Table, dnd-kit, shadcn charts)

Needs-you inbox as home, tickets board and detail, quota and spend, projects, config, releases, dashboards, phone layout; design source of truth (ADR-0045, ADR-0059); what M1.3 and M1.19 built. Detail: [`ui.md`](ui.md)

### 7.6 Context sources (ADR-0033, ADR-0053)

Product and domain knowledge per project behind a `ContextSource` port: markdown docs first, including the project brief (`docs/product/brief.md`). Detail: [`context-sources.md`](context-sources.md)

---

## 8. Project template (what each managed project gets)

The file layout every managed repo starts with, its required CI checks, and how a project is onboarded. Detail: [`template-and-baseline.md` §8](template-and-baseline.md#8-project-template-what-each-managed-project-gets)

### 8.1 Project baseline (ADR-0031)

The inventory of every guardrail built here and how managed projects get it (composite action, managed or seed file, GitHub config, Terraform, runbook). **Every slice that adds or changes a guardrail updates that table in the same PR.** Detail: [`template-and-baseline.md` §8.1](template-and-baseline.md#81-project-baseline-adr-0031)

---

## 9. Security

Andy-only identity (Firebase Google sign-in + allow-list, MCP OAuth), HMAC webhooks, OIDC for Scheduler, Tasks and agent callbacks; read-only agents, writes only as PRs, Secret Manager, prompt-injection handling, audit, public-repo hygiene, pinned actions. Detail: [`security.md` §9](security.md#9-security)

### 9.1 Continuous security review (ADR-0025)

Deterministic scans and a security-review agent on every PR, a system security review weekly and per milestone, agent guardrails, and where each piece is implemented (ADR-0030). Detail: [`security.md` §9.1](security.md#91-continuous-security-review-adr-0025)

---

## 10. Observability and cost

OTel traces and logs, run records driving the UI, API-equivalent cost estimates for subscription runs, no stored transcripts. Detail: [`observability-and-cost.md` §10](observability-and-cost.md#10-observability-and-cost)

### 10.1 GCP cost guardrails (ADR-0028)

Usage caps, budget alerts, fast usage alerts and the opt-in kill switch. Detail: [`observability-and-cost.md` §10.1](observability-and-cost.md#101-gcp-cost-guardrails-adr-0028)

### 10.2 Local quality gates (ADR-0027)

The same checks on agent edits, commit, push and CI. Detail: [`observability-and-cost.md` §10.2](observability-and-cost.md#102-local-quality-gates-adr-0027)

### 10.3 Data

Daily Firestore backups with 7-day retention. Detail: [`observability-and-cost.md` §10.3](observability-and-cost.md#103-data)

### 10.4 Data evolution (ADR-0035)

Additive schema changes by default; breaking ones bump `SCHEMA_VERSION` with a tested read-time upgrader. Detail: [`observability-and-cost.md` §10.4](observability-and-cost.md#104-data-evolution-adr-0035)

---

## 11. Technology choices

| Concern         | Choice                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Language / repo | TypeScript, pnpm workspaces monorepo                                                                                                           |
| API             | Node HTTP framework with Zod-based OpenAPI generation (builder to propose; e.g., Hono + zod-openapi)                                           |
| MCP             | Official MCP TypeScript SDK, Streamable HTTP, OAuth                                                                                            |
| DB              | Firestore (Native mode, default database, us-central1; free tier) with Zod-validated converters; no migrations (ADR-0017)                      |
| UI              | React, Vite, shadcn/ui, Tailwind, TanStack Router/Query/Table, dnd-kit (board drag-and-drop), shadcn charts; OpenAPI-generated client          |
| Runtime         | Cloud Run (single service), Cloud Tasks, Cloud Scheduler (weekly scout), Secret Manager                                                        |
| Auth            | Firebase Auth / Identity Platform (Google) + MCP OAuth facade; GitHub Actions OIDC for agent callbacks                                         |
| Work tracker    | Native in Firestore + in-app UI + MCP (ADR-0016)                                                                                               |
| Code host       | One GitHub App on Andy's personal account, connected from the UI (ADR-0041, ADR-0043); public repos (ADR-0003, ADR-0015)                       |
| Executors       | GitHub Actions (Claude Code, OpenCode), Jules REST API, OpenRouter                                                                             |
| Release         | Cloud Deploy (per project)                                                                                                                     |
| IaC             | Terraform, version pinned in `.terraform-version`, installed with tenv (ADR-0024); provider versions pinned in committed `.terraform.lock.hcl` |
| Telemetry       | OpenTelemetry → Cloud Trace / Logging                                                                                                          |
| Evals           | Agent evals in CI from M1.17: Agent evals v1: in-repo runner over Claude Code (ADR-0086); Ori Eval for scout smoke tests           |

---

## 12. Milestones (v1.x)

Each milestone must work **end to end** before the next starts (a ticket may start early only as ADR-0060 allows). Acceptance criteria are verified by Andy. Every milestone's "Done when" also requires a system security review with no open high/critical risks, unless Andy accepted them (§9.1).

| ID  | Milestone                                      | Outcome                                                                                                       |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| M0  | Foundations: repo, sign-in, GCP infra          | Empty app on Cloud Run, Andy-only sign-in, Terraform in place                                                 |
| M1  | First end-to-end flow: ticket → PR with Claude | One project; ticket created from Claude desktop is refined, built by Claude Code, and merged                  |
| M2  | Self-hosting: andy-intelligence builds itself  | Project `AI` builds and merges its own tickets, several at once, while Andy is away                           |
| M3  | New UI and MCP                                 | Project picker, board that shows status, story panel, command palette; MCP tools to edit and organize tickets |
| M4  | Epics + story board                            | Epics; epic grouping on the board; config editing; design skills and dashboards                               |
| M5  | Multi-project in parallel                      | Several repos onboarded; stories per project; runs across projects at once under caps and quota               |
| M6  | Dev → prod releases                            | Per-project dev/prod deploys, verification, one-click promote, DORA metrics                                   |
| M7  | Mobile                                         | The UI installed on Andy's phone with push notifications; answer, approve, promote and pause from anywhere    |
| M8  | Project members                                | Other users on a project, with basic roles                                                                    |
| M9  | Add Jules + model routing                      | Second agent; tiers route work by size; cross-model review                                                    |
| M10 | Paid models + spend caps                       | OpenRouter/OpenCode, hard spend caps, weekly model scout                                                      |

**Order (ADR-0060):** numbers follow completion order; a reorder renumbers milestones in a new ADR; the title is the stable name. Claude-only through M8.

**Older documents** use earlier numbers: ADR-0060 has the mapping (ADR-0035 for ADRs before 2026-11-01).

**Naming:** always write a milestone or slice as `ID: title`, e.g. "M1.2: Ticket core". The ID alone means nothing to a reader.

**Detail** in [`milestones.md`](milestones.md): how milestones are built as slices, each milestone's scope and "Done when", the open M1 slice rows, and **Later** (explicitly deferred work, e.g. "Control plane in dev + prod"). Merged M1 slices: [`history/m1-merged-slices.md`](history/m1-merged-slices.md).

---

## 13. Open questions

Resolved in M0: GitHub home (personal account, public repos — ADR-0003); GCP project `andy-intelligence-512400` in `us-central1` (ADR-0007); Firestore (ADR-0017); default run.app URL (ADR-0007; replaced by `ai.andybernhagen.com` in M1.20: Custom domain, ADR-0044); work tracking native (ADR-0016).

Resolved in M1.0: Docs sync (ADR-0018 – ADR-0024): Jules completion detection (PR webhook + deadline watchdog); agent callback auth (GitHub Actions OIDC); rollups (aggregation queries); M1 scope cuts and slicing; docs upkeep; contract suites for every port (ADR-0012 rejected).

Remaining:

2. Naming convention for per-project dev/prod GCP projects (needed by M6: Dev → prod releases).
5. ~~Claude plan (Pro vs Max) — affects automated-run budget~~ — **decided (ADR-0050)**: automated runs use Andy's subscription for now, behind a `Provider` so a capped API key is configuration later. Verified in M1.6a (ADR-0051): Anthropic's docs bill OAuth-token runs to the subscription and document `claude setup-token` for CI; plan limits assume ordinary individual use.
6. Google plan (AI Pro vs Ultra) and current Jules daily task quota.
7. OpenRouter: account exists? initial monthly/daily caps?
8. ~~First real side project to onboard in M1: First end-to-end flow~~ — **answered in M1.5: GitHub App + project registration**: andy-intelligence itself is project #1 (ADR-0041); side projects in M5: Multi-project in parallel.
9. ~~Claude custom-connector OAuth mechanism currently supported (dynamic client registration vs static client)~~ — **answered by M1.1: MCP OAuth spike**: CIMD against our own authorization server (ADR-0039).
10. Whether the Jules GitHub integration or the Jules REST API should be the dispatch path (REST preferred for run tracking; must support auto-PR creation for the completion signal).
11. Local mode design (ADR-0032): markdown ticket format, local executor (Claude Code CLI) and its trust boundary, local storage/queue/auth adapters, devkit packaging and versioning. Local executor **answered by ADR-0089** (AI-44: the runner polls); the rest due later.
12. Context sources design (ADR-0033): markdown kind **answered by ADR-0053** (brief, interview, step mapping). Port shape and MCP registration: after M5: Multi-project in parallel.

---

## 14. Documentation

Docs are part of the change, not a follow-up (ADR-0022): every PR updates the docs its change affects, written short and plain. The doc map (which doc owns what, and when it changes) is in [`documentation.md`](documentation.md).
