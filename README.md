# andy-intelligence

Personal control plane for agentic software development: ideas → refined tickets → agent runs (Claude Code, Jules, OpenCode) under cost and quota controls → PRs → dev → one-click prod.

## Docs

| Doc                                                                      | What                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) | Design and milestone/slice plan — source of truth           |
| [`docs/architecture/adr/`](docs/architecture/adr/)                       | Architecture decisions (MADR)                               |
| [`docs/build-log.md`](docs/build-log.md)                                 | Slice status, pending decisions, blockers                   |
| [`docs/security/threat-model.md`](docs/security/threat-model.md)         | Threat model and open security risks                        |
| [`docs/runbooks/`](docs/runbooks/)                                       | Manual steps (setup, secrets, apply)                        |
| [`AGENTS.md`](AGENTS.md)                                                 | Rules for agents working in this repo (`CLAUDE.md` symlink) |
| [`docs/BUILD-PROMPT.md`](docs/BUILD-PROMPT.md)                           | Session prompt for the building agent                       |

Docs ship with the change: a PR that changes commands, layout, design, or a decision updates the matching doc (ARCHITECTURE §14, ADR-0022).

## Develop

Tools: Node from `.nvmrc`; pnpm (`corepack enable`); Terraform from `.terraform-version` via [tenv](https://github.com/tofuutils/tenv) (`brew install tenv`); optional [actionlint](https://github.com/rhysd/actionlint) (`brew install actionlint`).

```sh
pnpm install
pnpm test        # vitest, all packages
pnpm typecheck
pnpm lint
pnpm build
pnpm format      # prettier --write
pnpm test:firestore  # Firestore adapter contract suite on the emulator (needs Java 21+: `brew install openjdk@21`; not in CI, ADR-0034)
```

### Quality gates (ADR-0027)

`pnpm install` installs the git hooks ([lefthook](https://lefthook.dev), `lefthook.yml`):

| Hook       | Runs on staged files                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| pre-commit | `prettier --check`, `eslint`, `terraform fmt -check`, actionlint (skipped if absent) |
| pre-push   | `pnpm typecheck`, `pnpm test` (whole repo)                                           |

Claude Code runs `scripts/format-edited-file.mjs` after each Edit/Write (`.claude/settings.json`): Prettier + ESLint `--fix` on that file; unfixable lint errors go back to the agent. CI runs the same checks plus build and actionlint. Formatting failure on commit: `pnpm format`, re-stage. `--no-verify` is for emergencies only.

### Security checks on PRs (ADR-0025, ADR-0030)

| Check                                                | Workflow                 | Fails on                                                                                                  |
| ---------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `trufflehog`                                         | `secret-scan.yml`        | Verified or unverifiable secrets                                                                          |
| `codeql (javascript-typescript)`, `codeql (actions)` | `security-scans.yml`     | Code scanning alerts, high or higher (ruleset)                                                            |
| `dependency-review`                                  | `security-scans.yml`     | New dependency with a high/critical advisory                                                              |
| `terraform-misconfig`                                | `security-scans.yml`     | Trivy HIGH/CRITICAL in `infra/`                                                                           |
| `security-review`                                    | `security-review.yml`    | Agent finding high/critical, unless labelled `security-accepted` (docs-only PRs skip the agent)           |
| `adversarial-review`                                 | `adversarial-review.yml` | Agent `blocker` with a failing scenario, unless labelled `review-accepted` (docs-only PRs skip the agent) |

Weekly + manual: `system-security-review.yml` opens a PR updating the threat model. Action pins are commit SHAs, bumped by Dependabot.

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

Set `PUBLIC_URL` (the service's public origin, e.g. `http://localhost:8080`) to turn on `/mcp` and its OAuth endpoints (ADR-0039: MCP OAuth facade); Terraform sets it in Cloud Run.

MCP tools (M1.4: MCP core tools, `apps/api/src/mcp/tools.ts`): `create_ticket`, `list_needs_me`, `answer_question`, `status` (no ticket: overview + who you're signed in as). They call the same `TicketService` as the REST API.

### Web UI (M1.3: UI: tickets + inbox)

| Route                       | Screen                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `/`                         | Needs you (home): open questions (options, suggested answer, free text) and flagged tickets      |
| `/projects`                 | Project list and "new project"                                                                   |
| `/p/:projectId`             | Tickets in one column per stage, "new ticket"                                                    |
| `/p/:projectId/t/:ticketId` | Ticket detail: edit, Definition of Ready, moves (forced move needs a reason), questions, history |

- API client: `openapi-fetch` typed by `apps/web/src/lib/api.gen.ts`, generated from the API's OpenAPI document. After changing an API route, run `pnpm --filter @andy/web gen:api` and commit the file; a test fails while it is stale.
- Tests (`apps/web/src/**/*.test.tsx`, jsdom + Testing Library) render the UI against the real API in-process (`createApp` + `InMemoryWorkTracker`), so they also exercise auth, validation and the ticket rules. No browser e2e yet: it needs Firebase sign-in.
- To try the inbox before refinement agents exist (M1.7: Refinement), use "Ask a question…" on a ticket.

## Layout

| Path                  | What                                                          |
| --------------------- | ------------------------------------------------------------- |
| `apps/api`            | Hono API, MCP endpoint + its OAuth server; serves the SPA     |
| `apps/web`            | React + Vite + shadcn UI: Needs-you inbox, tickets, detail    |
| `packages/contracts`  | Zod entities, ports, fakes, contract suites                   |
| `packages/domain`     | Ticket rules: stage moves, Definition of Ready, Needs-you     |
| `packages/store`      | Firestore client, converters, `FirestoreWorkTracker`          |
| `infra/bootstrap`     | One-time GCP bootstrap (state bucket, GitHub OIDC)            |
| `infra/control-plane` | Control-plane GCP resources                                   |
| `infra/billing`       | Billing budget, alerts, opt-in kill switch (local plans only) |
| `scripts`             | Repo tooling (Claude Code format hook, review gate and scope) |
| `platform/actions`    | Composite actions behind every required check (baseline)      |
| `platform/baseline`   | Baseline manifest, GitHub config JSON, `baseline.mjs`         |
| `platform/procedures` | Agent procedures: `/security-review`, `/threat-model`         |
| `template`            | Files copied into managed repos (managed, seed, starter)      |
| `lefthook.yml`        | Git hooks: pre-commit lint/format, pre-push checks            |
| `firebase.json`       | Firestore emulator config for `pnpm test:firestore`           |

Infra setup: [`docs/runbooks/m0-setup.md`](docs/runbooks/m0-setup.md). Budget and cost caps: [`docs/runbooks/billing.md`](docs/runbooks/billing.md). Security review setup: [`docs/runbooks/security-review.md`](docs/runbooks/security-review.md). Adversarial review: [`docs/runbooks/adversarial-review.md`](docs/runbooks/adversarial-review.md). Onboard a repo: [`docs/runbooks/onboard-a-repo.md`](docs/runbooks/onboard-a-repo.md). Connect Claude to MCP: [`docs/runbooks/mcp-connector.md`](docs/runbooks/mcp-connector.md).
