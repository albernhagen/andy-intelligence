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

**Working** (full list: [`docs/how-it-works.md`](docs/how-it-works.md)): a board and Needs-you inbox, the Claude connector (MCP), Refine and Build agent tasks on GitHub Actions or a local runner, PR checks and review agents, the merge gate and MCP `merge_pr` for coordinator sessions through a merge queue per repo, dispatch under quota and spend caps, product discovery before the brief (`/discover`), epics and the roadmap (a case per milestone; the `epic` merge mode merges child tickets into the epic's branch), digest, What's new, dashboards and Needs-you email. Each feature: [`docs/features/`](docs/features/). New detail goes in `docs/how-it-works.md`, so this section stays one screen.

**Not built yet:** Needs you has no push notification (M7); one task at a time per ticket; the digest is not sent anywhere.

## Docs

| Doc                                                                      | What                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) | Design overview, milestone table, reading map — source of truth; detail in topic files beside it (ADR-0061)    |
| [`docs/architecture/adr/`](docs/architecture/adr/)                       | Architecture decisions (MADR)                                                                                  |
| [`docs/build-log.md`](docs/build-log.md)                                 | Pending decisions, blockers (history: `docs/build-log/`); the milestone map: MCP `milestone_map`, from tickets |
| [`docs/product/brief.md`](docs/product/brief.md)                         | Project brief for project `AI`: idea, users, vision, goals, architectural expectations (ADR-0053)              |
| [`docs/features/`](docs/features/)                                       | Shipped features, one file each, and how to use them                                                           |
| [`docs/how-it-works.md`](docs/how-it-works.md)                           | What is built today, the full list (the summary above stays one screen)                                        |
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

| Hook       | Runs on staged files                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| pre-commit | `prettier --check`, `eslint`, `terraform fmt -check`, actionlint (skipped if absent)  |
| pre-push   | `pnpm typecheck`, tests the push affects on a quarter of the cores (ADR-0113, AI-219) |

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
- Screenshot checks (`apps/web/e2e/`, Playwright): shell, board, ticket panel and a busy inbox against the API over seeded fakes. CI job `ui-screenshots` fails on a diff and uploads the actual images. Stored images are Linux renders:

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
