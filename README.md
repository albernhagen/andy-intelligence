# andy-intelligence

Personal control plane for agentic software development: ideas → refined tickets → agent tasks (Claude Code, Jules, OpenCode) under cost and quota controls → PRs → dev → one-click prod.

## How it works today

What is built on `main` now. Target design: [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md); progress: tickets in project `AI` (map, decisions, blockers: [`docs/build-log.md`](docs/build-log.md)). Update it in the same PR as the change.

```
 Browser UI ─┐                                   ┌─ Firestore (tickets, questions, history, runs, OAuth grants, webhook events)
             ├─▶ Cloud Run: control-plane ───────┤
 Claude (MCP)┤   API + /mcp + OAuth + SPA        ├─ Cloud Tasks queue (run-watchdog: one check per run at its deadline)
 GitHub App ─┘   + /webhooks/github                ├─ Secret Manager (GitHub App key, webhook secret, Resend key)
                                                   └─ Resend (Needs-you email; off until configured)
 GitHub PRs ──▶ CI checks + review agents (GitHub Actions)
 Agent tasks ◀─▶ agent-run.yml → claude-executor.yml (GitHub Actions; dispatched by the App, call back with OIDC)
```

**Working:** tickets on a board (Backlog split into Up next and Ideas; only Up next gets refined; cards show size, risk and confidence; Ready sorts by them; MCP `list_ready` filters them) with a Needs-you inbox, answerable in the UI or the `/inbox` skill in Claude Code; a Claude connector (MCP) with every ticket decision the UI offers; GitHub PRs that move tickets; Refine and Build agent tasks on GitHub Actions; PR checks and review agents; the merge gate (an agent PR merges itself when checks and reviews pass, no veto applies and `autoMerge` covers its size; `AI` stays `none`); Dependabot; the project baseline; agent evals (runbook `agent-evals.md`); cost guardrails. Each feature and how to use it: [`docs/features.md`](docs/features.md). Each project has a default worker (agent, Andy or ask) and executor (GitHub Actions or a local runner); a ticket can override both; only an agent's tickets build. Settings → Local runners mints secrets for `apps/local-runner` (refine and plan on Andy's Mac, ADR-0089). Project settings (`/p/<project>/settings`): every switch (MCP `get_project_settings`), and the setup checklist until done. Pages poll: 5 s in use, 60 s idle, none hidden (ADR-0091). A header gauge and banner show Claude quota from task reports. Agent task cost: story panel, Activity (links each task's page), MCP `status`. Epics: stories, cost, night launch (`docs/runbooks/overnight-runs.md`). A daily digest (header → Digest, MCP `digest`) lists the last 24 hours: exceptions, merges and cost, work in progress, totals. Dashboards chart delivery and cost per week (AI-117). Needs-you email (AI-77): each ticket that needs Andy, batched per 10 minutes, 20 a day; off until configured (runbook `email-notifications.md`). Config proposals (inbox, MCP): a finding kind on 3+ PRs becomes a pending `AGENTS.md` change, never applied; idle until findings are stored (ADR-0097).

**Dispatch:** with auto-build on, Ready tickets start from the top, up to the project's "Agent tasks at once" dial (default 2, max 4), 4 across projects and 5 agent PRs waiting for Andy; "Paused" stops new starts, and so does the quota reserve. Project settings, the board and MCP `status` show why dispatch is idle (ADR-0079). A ticket whose `touches` overlap a build in flight waits ("Waiting: overlaps AI-12 in flight") while the next starts; the board's In flight panel and MCP `list_in_flight` show each task's ticket, branch, PR and files, and each build gets its own ADR number (ADR-0080). Blockers can be in any project (AI-96). **Clear quota idle** (banner, Project settings, MCP `clear_quota_idle`) discards a distrusted quota reading, logged with who and when; the digest lists it (AI-74). When `main` moves, each open agent PR lacking it gets a sync task: merge `main`, resolve conflicts, rerun checks, push; an unsettled conflict goes to Needs you; no auto-merge while a sync is pending (ADR-0083).

**Not built yet:** Needs you has no push notification (M7); one task at a time per ticket; the digest is not sent anywhere.

## Docs

| Doc                                                                      | What                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) | Design overview, milestone table, reading map — source of truth; detail in topic files beside it (ADR-0061)    |
| [`docs/architecture/adr/`](docs/architecture/adr/)                       | Architecture decisions (MADR)                                                                                  |
| [`docs/build-log.md`](docs/build-log.md)                                 | Slice → ticket map (status: tickets in project `AI`), pending decisions, blockers (history: `docs/build-log/`) |
| [`docs/product/brief.md`](docs/product/brief.md)                         | Project brief for project `AI`: idea, users, vision, goals, architectural expectations (ADR-0053)              |
| [`docs/architecture/adr/README.md`](docs/architecture/adr/README.md)     | ADR index, one line each                                                                                       |
| [`docs/features.md`](docs/features.md)                                   | Shipped features, one row each, and how to use them                                                            |
| [`docs/security/threat-model.md`](docs/security/threat-model.md)         | Threat model and open security risks                                                                           |
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
pnpm test:firestore  # Firestore adapters on the emulator (Java 21+; CI runs them on adapter changes, ADR-0048)
node apps/local-runner/dist/main.js login|start|check-settings  # local runner (macOS, after pnpm build)
scripts/sandbox-lab/run.sh  # build sandbox in Docker; CI job sandbox-self-test runs it on executor changes (runbook agent-runs.md §9a)
```

### Quality gates (ADR-0027)

`pnpm install` installs the git hooks ([lefthook](https://lefthook.dev), `lefthook.yml`):

| Hook       | Runs on staged files                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| pre-commit | `prettier --check`, `eslint`, `terraform fmt -check`, actionlint (skipped if absent) |
| pre-push   | `pnpm typecheck`, `pnpm test` (whole repo)                                           |

Claude Code runs `scripts/format-edited-file.mjs` after each Edit/Write (`.claude/settings.json`): Prettier + ESLint `--fix` on that file; unfixable lint errors go to the agent. CI runs these plus build and actionlint. Format failure on commit: `pnpm format`, re-stage. `--no-verify` is for emergencies only.

### Security checks on PRs (ADR-0025, ADR-0030)

| Check                                                | Workflow                 | Fails on                                                                                                  |
| ---------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `trufflehog`                                         | `secret-scan.yml`        | Verified or unverifiable secrets                                                                          |
| `codeql (javascript-typescript)`, `codeql (actions)` | `security-scans.yml`     | Code scanning alerts, high or higher (ruleset)                                                            |
| `dependency-review`                                  | `security-scans.yml`     | New dependency with a high/critical advisory                                                              |
| `terraform-misconfig`                                | `security-scans.yml`     | Trivy HIGH/CRITICAL in `infra/`                                                                           |
| `security-review`                                    | `security-review.yml`    | Agent finding high/critical, unless labelled `security-accepted` (docs-only PRs skip the agent)           |
| `adversarial-review`                                 | `adversarial-review.yml` | Agent `blocker` with a failing scenario, unless labelled `review-accepted` (docs-only PRs skip the agent) |
| `agent-evals` (not required yet)                     | `agent-evals.yml`        | Agent-config change: pass rate under 90%, or input tokens +20%                                            |

Weekly + manual: `system-security-review.yml` opens a PR updating the threat model. Action pins are commit SHAs, bumped by Dependabot.

Dependabot (ADR-0042): npm updates that are patches, or minors of packages at 1.0+ auto-merge once the required checks pass (`dependabot-auto-merge.yml`); majors, 0.x minors, GitHub Actions and Terraform providers wait for Andy. Bot merges never deploy (`deploy.yml` guard). `.github/CODEOWNERS` requests Andy's review on every PR he didn't author.

The steps behind these checks live in composite actions in `platform/actions/`; the workflows only set triggers, permissions and the job names the `main` ruleset requires (ADR-0038).

### Project baseline (ADR-0031, ADR-0038)

Every repo Andy manages gets the same checks, files and GitHub settings (ARCHITECTURE §8.1). Run from this repo with your `gh` login; never in CI. Steps: [`docs/runbooks/onboard-a-repo.md`](docs/runbooks/onboard-a-repo.md).

```sh
node platform/baseline/baseline.mjs onboard <owner/repo> --ref v1.0.0   # files + GitHub settings
node platform/baseline/baseline.mjs apply <owner/repo> --dry-run        # show settings drift
node platform/baseline/baseline.mjs check <owner/repo>                  # drift report; exit 1 on drift
```

Run locally (needs a Firebase project for sign-in):

```sh
GCP_PROJECT_ID=andy-intelligence-512400 ALLOWED_EMAILS=you@example.com \
FIREBASE_API_KEY=... FIREBASE_AUTH_DOMAIN=andy-intelligence-512400.firebaseapp.com \
pnpm --filter @andy/api dev          # :8080
pnpm --filter @andy/web dev          # :5173, proxies /api to :8080
```

Set `PUBLIC_URL` (public origin, e.g. `http://localhost:8080`) to turn on `/mcp` and its OAuth endpoints (ADR-0039: MCP OAuth facade).

Run watchdog (M1.6b: Claude Code executor: watchdog + retry): on when `PUBLIC_URL`, `WATCHDOG_QUEUE` (Cloud Tasks queue name, `projects/…/queues/run-watchdog`) and `WATCHDOG_INVOKER_EMAIL` (the `tasks-invoker` service account) are set; Terraform sets them. Off locally: no deadline check.

Needs-you email (AI-77): on when `RESEND_API_KEY`, `EMAIL_FROM` and `EMAIL_TO` are set (Terraform, with `email_enabled`); else off, logged once. Flushes ride the `run-watchdog` queue. Setup: [`docs/runbooks/email-notifications.md`](docs/runbooks/email-notifications.md).

MCP tools live in `apps/api/src/mcp/tools.ts` and call the same `TicketService` as the REST API; `archive_ticket` hides Done or Cancelled tickets from board, inbox and counts.

GitHub (ADR-0043: GitHub App setup from the UI) is on when `PUBLIC_URL` is set: connect it from `/settings/github`. The App's key and webhook secret live in Secret Manager (written by the API, read at runtime); CI jobs get repo tokens from `POST /github/token` with their Actions OIDC token. Locally without `PUBLIC_URL`, repos on projects are only format-checked. Setup: [`docs/runbooks/github-app.md`](docs/runbooks/github-app.md).

### Web UI (M1.3: UI: tickets + inbox; AI-26: Design source and app shell)

Design rules: [`apps/web/design.md`](apps/web/design.md). One header on every screen: project picker (the scope, remembered), Board, Inbox, Dashboards, Settings, "Needs you N".

| Route                                         | Screen                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/`                                           | Opens the inbox in the last-picked scope                                                                                      |
| `/p/:projectId/inbox`, `/all/inbox`           | Needs you: a card per ticket; each question with context, options and their consequences, a recommendation; one-click answers |
| `/all/board`                                  | Asks for a project                                                                                                            |
| `/p/:projectId/dashboards`, `/all/dashboards` | Dashboards: weekly delivery and cost charts                                                                                   |
| `/p/:projectId/settings`                      | Project settings (header link): every switch and what it does; MCP `get_project_settings` reads them                          |
| `/projects`, `/projects/new`                  | Open the current project's settings; add a project (picker → Add project)                                                     |
| `/settings/github`                            | Connect the GitHub App, install link, installed repos                                                                         |
| `/p/:projectId`                               | Board: lanes with status on cards, quick add, drag to reorder or move                                                         |
| `/p/:projectId/t/:ticketRef`                  | Ticket detail (ref = key, e.g. `AI-2`): edit, Definition of Ready, moves, agent tasks, questions, history                     |

- API client: `openapi-fetch` typed by `apps/web/src/lib/api.gen.ts`, generated from the API's OpenAPI document. After changing an API route, run `pnpm --filter @andy/web gen:api` and commit the file; a test fails while it is stale.
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
| `scripts`             | Repo tooling (Claude Code format hook, review gate and scope)       |
| `platform/actions`    | Composite actions behind every required check (baseline)            |
| `platform/baseline`   | Baseline manifest, GitHub config JSON, `baseline.mjs`               |
| `platform/executor`   | Permission profile for headless agent tasks (ADR-0051)              |
| `platform/procedures` | Agent procedures and their output schemas                           |
| `context-budget.json` | Size budgets for agent-loaded docs (`pnpm context:check`, ADR-0046) |
| `template`            | Files copied into managed repos (managed, seed, starter)            |
| `lefthook.yml`        | Git hooks: pre-commit lint/format, pre-push checks                  |
| `firebase.json`       | Firestore emulator config for `pnpm test:firestore`                 |

Runbooks for every manual step (infra setup, billing, reviews, onboarding, MCP, GitHub App, DNS): [`docs/runbooks/`](docs/runbooks/). Deploys and going back to an earlier revision: [`deploy-and-rollback.md`](docs/runbooks/deploy-and-rollback.md).
