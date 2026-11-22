# andy-intelligence

Personal control plane for agentic software development: ideas → refined tickets → agent tasks (Claude Code, Jules, OpenCode) under cost and quota controls → PRs → dev → one-click prod.

## How it works today

What is built on `main` now. Target design: [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md); progress: tickets in project `AI` (milestone map: MCP `milestone_map`; decisions, blockers: [`docs/build-log.md`](docs/build-log.md)). Update it in the same PR as the change.

```
 Browser UI ─┐                                   ┌─ Firestore (tickets, questions, history, runs, OAuth grants, webhook events)
             ├─▶ Cloud Run: control-plane ───────┤
 Claude (MCP)┤   API + /mcp + OAuth + SPA        ├─ Cloud Tasks queue (run-watchdog: one check per run at its deadline)
 GitHub App ─┘   + /webhooks/github                ├─ Secret Manager (GitHub App key, webhook secret, Resend key)
                                                   └─ Resend (Needs-you email; off until configured)
 GitHub PRs ──▶ CI checks + review agents (GitHub Actions)
 Agent tasks ◀─▶ agent-run.yml → claude-executor.yml (GitHub Actions; dispatched by the App, call back with OIDC)
```

**Working:** tickets on a board (Backlog split into Up next and Ideas; only Up next gets refined; cards show size, risk and confidence; Ready sorts by them; MCP `list_ready` filters them; MCP `board` reads it) with a Needs-you inbox, answerable in the UI or with the `/inbox` skill in Claude Code; a Claude connector (MCP) with every ticket decision the UI offers; GitHub PRs that move tickets; Refine and Build agent tasks on GitHub Actions; PR checks and review agents; the merge gate (an agent PR merges itself when checks and reviews pass, no veto applies and `autoMerge` covers its size; `AI` stays `none`); Dependabot; the project baseline; agent evals (runbook `agent-evals.md`); cost guardrails. Each feature: [`docs/features/`](docs/features/). Each project has a default worker (agent, Andy or ask) and executor (GitHub Actions or a local runner); a ticket can override both; only an agent's tickets build. Settings → Local runners mints secrets for `apps/local-runner` (refine and plan on Andy's Mac, ADR-0089). Project settings (`/p/<project>/settings`): switches, setup checklist, changes with Revert. Pages poll: 5 s in use, 60 s idle, none hidden (ADR-0091). Keyboard: `?` lists the shortcuts (AI-338). A header gauge and banner show Claude quota from task reports; on a phone the header shows the fullest window and a one-tap **Pause**/**Resume** (AI-176). Agent task cost: story panel, Activity (links each task's page), MCP `status`. Epics: stories, cost; map: MCP `milestone_map`; Roadmap (header, MCP `roadmap`): milestones and their epics; epics and the board's epic groups show their milestone's status, which Andy sets there or on the roadmap (AI-311). Dispatch starts a ticket only when its milestone is approved or it has none (AI-306). A daily digest (What's new → Digest, MCP `digest`) lists the last 24 hours: exceptions, merges and cost, work in progress, totals. What's new (header, MCP `whats_new`): milestones, merged PRs' release notes. Dashboards chart delivery and cost per week (AI-117), and a project's DORA metrics over 30 or 90 days from its production deployment records (AI-200; lead time not measured until commit times are recorded). Needs-you email (AI-77): each ticket that needs Andy, batched per 10 minutes, 20 a day; off until configured (runbook `email-notifications.md`). Config proposals (inbox, MCP): a finding kind on 3+ PRs becomes a pending `AGENTS.md` change, never applied; idle until findings are stored (ADR-0097).

**Dispatch:** with auto-build on, Ready tickets start from the top, up to the project's "Agent tasks at once" dial (default 2, max 4), 4 across projects (1 at quota warn) and 5 agent PRs waiting for Andy; "Paused" stops new starts, and so does the quota reserve. Project settings, the board and MCP `status` show why dispatch is idle (ADR-0079). A ticket whose `touches` overlap a build in flight waits ("Waiting: overlaps AI-12 in flight") while the next starts; the board's In flight panel and MCP `list_in_flight` show each task's ticket, branch, PR and files, and each build gets its own ADR number (ADR-0080). Blockers can be in any project (AI-96). **Clear quota idle** (banner, Project settings, MCP `clear_quota_idle`) discards a quota reading you don't believe, logged with who and when; the digest lists it (AI-74). When `main` moves, each open agent PR lacking it gets a sync task: merge `main`, resolve conflicts, rerun checks, push; an unsettled conflict goes to Needs you; no auto-merge while a sync is pending (ADR-0083). Paid (`pay_per_use`) routes reserve their per-task cap in the spend ledger first and don't start past a cap or without a price (`spend_cap`, AI-248); none has a price yet. `claude-api` (Claude Code on an API key, off by default) runs paid tasks under their reserved budget (AI-260).

**Project agent tasks (AI-134):** Andy starts plan-project or ideate as a read-only agent task (`POST …/plan/agent-task`, `…/ideate/agent-task`); its result is stored as a submitted one, so a plan waits for approval and an idea becomes an epic with a spec PR or a question. No MCP tool or button yet.

**Not built yet:** Needs you has no push notification (M7); one task at a time per ticket; the digest is not sent anywhere.

## Docs

| Doc                                                                      | What                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) | Design overview, milestone table, reading map — source of truth; detail in topic files beside it (ADR-0061)    |
| [`docs/architecture/adr/`](docs/architecture/adr/)                       | Architecture decisions (MADR)                                                                                  |
| [`docs/build-log.md`](docs/build-log.md)                                 | Pending decisions, blockers (history: `docs/build-log/`); the milestone map: MCP `milestone_map`, from tickets |
| [`docs/product/brief.md`](docs/product/brief.md)                         | Project brief for project `AI`: idea, users, vision, goals, architectural expectations (ADR-0053)              |
| [`docs/features/`](docs/features/)                                       | Shipped features, one file each, and how to use them                                                           |
| [`docs/security/threat-model.md`](docs/security/threat-model.md)         | Threat model; risks: `docs/security/risks/`, `pnpm risks`                                                      |
| [`docs/runbooks/`](docs/runbooks/)                                       | Manual steps (setup, secrets, apply)                                                                           |
| [`AGENTS.md`](AGENTS.md)                                                 | Rules for agents working in this repo (`CLAUDE.md` symlink)                                                    |
| [`docs/BUILD-PROMPT.md`](docs/BUILD-PROMPT.md)                           | Session prompt for the building agent                                                                          |

Docs ship with the change (ADR-0022).

## Develop

Tools: Node from `.nvmrc`; pnpm (`corepack enable`); Terraform from `.terraform-version` via [tenv](https://github.com/tofuutils/tenv) (`brew install tenv`); optional [actionlint](https://github.com/rhysd/actionlint) (`brew install actionlint`).

```sh
pnpm install
pnpm test        # vitest, all packages
pnpm typecheck
pnpm lint
pnpm build
pnpm format      # prettier --write
pnpm context:check   # agent-loaded docs within their size budgets (ADR-0046)
pnpm adr             # ADR index, from each ADR's frontmatter
pnpm features        # features table
pnpm reference       # every MCP tool and API route, from the code
pnpm test:firestore  # Firestore adapters on the emulator (Java 21+; CI runs them on adapter changes, ADR-0048)
node apps/local-runner/dist/main.js login|start|check-settings  # local runner (macOS, after pnpm build)
scripts/sandbox-lab/run.sh  # build sandbox in Docker; CI runs it on executor changes (runbook agent-runs.md §9a)
node scripts/coordinator/<tool>.mjs --help  # coordinator tools (runbook coordinating-sessions.md §7)
```

### Quality gates (ADR-0027)

`pnpm install` installs the git hooks ([lefthook](https://lefthook.dev), `lefthook.yml`):

| Hook       | Runs on staged files                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| pre-commit | `prettier --check`, `eslint`, `terraform fmt -check`, actionlint (skipped if absent) |
| pre-push   | `pnpm typecheck`, tests the push affects (ADR-0113)                                  |

Claude Code runs `scripts/format-edited-file.mjs` after each Edit/Write (`.claude/settings.json`): Prettier + ESLint `--fix` on that file; unfixable lint errors go to the agent. CI runs these plus build and actionlint. Format failure on commit: `pnpm format`, re-stage. `--no-verify` is for emergencies only.

Security checks on PRs, the project baseline and running locally: [`docs/develop-checks.md`](docs/develop-checks.md).

Run watchdog (M1.6b: Claude Code executor: watchdog + retry): on when `PUBLIC_URL`, `WATCHDOG_QUEUE` (Cloud Tasks queue name, `projects/…/queues/run-watchdog`) and `WATCHDOG_INVOKER_EMAIL` (the `tasks-invoker` service account) are set; Terraform sets them. Off locally: no deadline check.

Needs-you email (AI-77): on when `RESEND_API_KEY`, `EMAIL_FROM` and `EMAIL_TO` are set (Terraform, with `email_enabled`); else off, logged once. Flushes ride the `run-watchdog` queue. Setup: [`docs/runbooks/email-notifications.md`](docs/runbooks/email-notifications.md).

Each MCP tool module (`apps/api/src/mcp/tools-*.ts`) has one sorted line in `tool-groups.ts`; each route module exports `apiRoutes` or `publicRoutes`, one sorted line in `api-routes.ts` or `public-routes.ts` (AI-145). Tools call the same `TicketService` as the REST API. `pnpm reference` lists every tool and route.

Package barrels (ADR-0130): `exports.gen.ts` beside the `index.ts` of `packages/domain/src`, `packages/store/src` and the `packages/contracts` folders re-exports every module file in its folder. It is generated (not committed) by `pnpm install`, `lint`, `typecheck`, `test` and `build`, or `pnpm gen:exports`. A new module is a new file; nothing shared to edit. Modules kept internal are listed in `scripts/gen-exports.mjs`.

GitHub (ADR-0043: GitHub App setup from the UI) is on when `PUBLIC_URL` is set: connect it from `/settings/github`. The App's key and webhook secret live in Secret Manager (written by the API, read at runtime); CI jobs get repo tokens from `POST /github/token` with their Actions OIDC token. Locally without `PUBLIC_URL`, repos on projects are only format-checked. Setup: [`docs/runbooks/github-app.md`](docs/runbooks/github-app.md).

### Web UI (M1.3: UI: tickets + inbox; AI-26: Design source and app shell)

Design rules: [`apps/web/design.md`](apps/web/design.md). One header on every screen (AI-335): project picker (the scope, remembered), Inbox, Board, Roadmap, Work, Dashboards, What's new (in a project), "Needs you N" and a Settings menu (project settings, GitHub, Local runners, Models, Sign out).

| Route                                         | Screen                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/`                                           | Opens the inbox in the last-picked scope                                                                                      |
| `/p/:projectId/inbox`, `/all/inbox`           | Needs you: a card per ticket; each question with context, options and their consequences, a recommendation; one-click answers |
| `/all/board`                                  | Asks for a project                                                                                                            |
| `/p/:projectId/dashboards`, `/all/dashboards` | Dashboards: weekly delivery and cost charts                                                                                   |
| `/p/:projectId/settings`                      | Project settings (Settings menu): every switch and what it does; MCP `get_project_settings` reads them                        |
| `/projects`, `/projects/new`                  | Open the current project's settings; add a project (picker → Add project)                                                     |
| `/settings/github`                            | Connect the GitHub App, install link, installed repos                                                                         |
| `/p/:projectId`                               | Board: lanes with status on cards, quick add, drag to reorder or move                                                         |
| `/p/:projectId/t/:ticketRef`                  | Ticket detail (ref = key, e.g. `AI-2`): edit, Definition of Ready, moves, agent tasks, questions, history                     |

- API client: `openapi-fetch` typed by `apps/web/src/lib/api.gen.ts`, generated (not committed) by `pnpm typecheck` or `pnpm --filter @andy/web gen:api`.
- Tests (`apps/web/src/**/*.test.tsx`, jsdom) render the UI against the real API in-process (`createApp` + fakes), so they also exercise auth and the ticket rules.
- Screenshot checks (`apps/web/e2e/`, Playwright): shell, board, story panel and a busy inbox against the API over seeded fakes. CI job `ui-screenshots` fails on a diff and uploads the actual images. Stored images are Linux renders:

```sh
pnpm --filter @andy/web screenshots:update   # in Docker: write changed images, then commit them
pnpm --filter @andy/web screenshots          # local run (macOS renders differ)
```

## Layout

| Path                  | What                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `apps/api`            | Hono API, MCP endpoint + its OAuth server; serves the SPA           |
| `apps/web`            | React + Vite + shadcn UI; design rules in `design.md`               |
| `apps/local-runner`   | Local runner CLI: claims agent tasks, runs them on Andy's Mac       |
| `packages/contracts`  | Zod entities, ports, fakes, contract suites                         |
| `packages/domain`     | Ticket and project rules: stages, DoR, Needs-you, repo registration |
| `packages/store`      | Firestore client, converters, `FirestoreWorkTracker`                |
| `packages/github`     | GitHub App adapter: `GitHubCodeHost`, webhook HMAC + mapping        |
| `infra/bootstrap`     | One-time GCP bootstrap (state bucket, GitHub OIDC)                  |
| `infra/control-plane` | Control-plane GCP resources                                         |
| `infra/billing`       | Billing budget, alerts, opt-in kill switch (local plans only)       |
| `infra/dns`           | Cloudflare records for `ai.andybernhagen.com` (local plans only)    |
| `scripts`             | Repo tooling: format hook, review gate, coordinator tools           |
| `platform/actions`    | Composite actions behind every required check (baseline)            |
| `platform/baseline`   | Baseline manifest, GitHub config JSON, `baseline.mjs`               |
| `platform/executor`   | Permission profile for headless agent tasks (ADR-0051)              |
| `platform/procedures` | Agent procedures and their output schemas                           |
| `context-budget.json` | Size budgets for agent-loaded docs (`pnpm context:check`, ADR-0046) |
| `template`            | Files copied into managed repos (managed, seed, starter)            |
| `lefthook.yml`        | Git hooks: pre-commit lint/format, pre-push checks                  |
| `firebase.json`       | Firestore emulator config for `pnpm test:firestore`                 |

Runbooks for every manual step: [`docs/runbooks/`](docs/runbooks/). Deploys and going back to an earlier revision: [`deploy-and-rollback.md`](docs/runbooks/deploy-and-rollback.md).
