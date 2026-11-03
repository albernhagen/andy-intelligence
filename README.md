# andy-intelligence

Personal control plane for agentic software development: ideas → refined tickets → agent runs (Claude Code, Jules, OpenCode) under cost and quota controls → PRs → dev → one-click prod.

## How it works today

What is built on `main` now. The target design is [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md); progress is in [`docs/build-log.md`](docs/build-log.md). Update this section in the same PR as any change to features, components or how to use the system.

```
 Browser UI ─┐                                   ┌─ Firestore (tickets, questions, history, OAuth grants, webhook events)
             ├─▶ Cloud Run: control-plane ───────┤
 Claude (MCP)┤   API + /mcp + OAuth + SPA        ├─ Cloud Tasks queue (run-watchdog; nothing uses it yet)
 GitHub App ─┘   + /webhooks/github                └─ Secret Manager (GitHub App key, webhook secret)
 GitHub PRs ──▶ CI checks + review agents (GitHub Actions)
```

**Working:**

| Feature                | What it does                                                                                                                                                                                                                         | How to use                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Sign-in                | Google sign-in; only emails on the allow-list get in                                                                                                                                                                                 | Open the Cloud Run URL (`terraform output service_url` in `infra/control-plane`)         |
| Tickets                | Projects, tickets moving through stages (Backlog → Ready → In progress → Ready for review → Monitoring → Done), Definition of Ready, history, questions                                                                              | UI: `/projects`, then a project; or the REST API under `/api`                            |
| Needs-you inbox        | Open questions and flagged tickets in one place                                                                                                                                                                                      | UI home page `/`                                                                         |
| GitHub App + webhooks  | PR, check and workflow events on registered repos are recorded once each (replays are no-ops); off until the App is set up                                                                                                           | [`docs/runbooks/github-app.md`](docs/runbooks/github-app.md)                             |
| Project registration   | A project's repo must have the GitHub App installed and belongs to one project; project #1 is this repo (`AI`)                                                                                                                       | UI `/projects` → "GitHub repo" field                                                     |
| Claude connector (MCP) | Claude desktop signs in through our OAuth server; only a test `ping` tool so far                                                                                                                                                     | [`docs/runbooks/mcp-connector.md`](docs/runbooks/mcp-connector.md)                       |
| PR checks              | Lint, typecheck, tests, build, secret/CodeQL/dependency/Terraform scans, security-review and adversarial-review agents; weekly system review PRs come from a bot App so their checks run                                             | Automatic on every PR; overrides with the `security-accepted` / `review-accepted` labels |
| Dependabot updates     | Weekly grouped PRs; npm patches (and minors of 1.0+ packages) auto-merge after the checks pass and deploy with Andy's next merge; majors, 0.x minors, Actions and Terraform wait for Andy, who is requested as reviewer (CODEOWNERS) | Nothing for auto-merged ones; review the rest                                            |
| Project baseline       | Gives another repo the same checks, files and GitHub settings                                                                                                                                                                        | `platform/baseline/baseline.mjs` ([runbook](docs/runbooks/onboard-a-repo.md))            |
| Cost guardrails        | $25/month budget alerts, usage alerts, caps, opt-in kill switch at 150% of budget                                                                                                                                                    | [`docs/runbooks/billing.md`](docs/runbooks/billing.md)                                   |

**Not built yet:** agents doing ticket work. Nothing acts on webhook events yet. The next slices add the MCP ticket tools, the Claude Code executor, refinement, a plan step, and build → PR (ARCHITECTURE §12, M1: First end-to-end flow).

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

Set `PUBLIC_URL` (the service's public origin, e.g. `http://localhost:8080`) to turn on `/mcp` and its OAuth endpoints (ADR-0039: MCP OAuth facade); Terraform sets it in Cloud Run.

Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM) and `GITHUB_WEBHOOK_SECRET` to turn on the GitHub webhook receiver `POST /webhooks/github` and the App-installed check when a project is created with repos (ADR-0041: GitHub App credentials and webhook intake). Without them, repos are only format-checked. In Cloud Run the key and secret come from Secret Manager; setup: [`docs/runbooks/github-app.md`](docs/runbooks/github-app.md).

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

| Path                  | What                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `apps/api`            | Hono API, MCP endpoint + its OAuth server; serves the SPA           |
| `apps/web`            | React + Vite + shadcn UI: Needs-you inbox, tickets, detail          |
| `packages/contracts`  | Zod entities, ports, fakes, contract suites                         |
| `packages/domain`     | Ticket and project rules: stages, DoR, Needs-you, repo registration |
| `packages/store`      | Firestore client, converters, `FirestoreWorkTracker`                |
| `packages/github`     | GitHub App adapter: `GitHubCodeHost`, webhook HMAC + mapping        |
| `infra/bootstrap`     | One-time GCP bootstrap (state bucket, GitHub OIDC)                  |
| `infra/control-plane` | Control-plane GCP resources                                         |
| `infra/billing`       | Billing budget, alerts, opt-in kill switch (local plans only)       |
| `scripts`             | Repo tooling (Claude Code format hook, review gate and scope)       |
| `platform/actions`    | Composite actions behind every required check (baseline)            |
| `platform/baseline`   | Baseline manifest, GitHub config JSON, `baseline.mjs`               |
| `platform/procedures` | Agent procedures: `/security-review`, `/threat-model`               |
| `platform/github-app` | GitHub App manifests + `form.mjs` (manifest flow page)              |
| `template`            | Files copied into managed repos (managed, seed, starter)            |
| `lefthook.yml`        | Git hooks: pre-commit lint/format, pre-push checks                  |
| `firebase.json`       | Firestore emulator config for `pnpm test:firestore`                 |

Infra setup: [`docs/runbooks/m0-setup.md`](docs/runbooks/m0-setup.md). Budget and cost caps: [`docs/runbooks/billing.md`](docs/runbooks/billing.md). Security review setup: [`docs/runbooks/security-review.md`](docs/runbooks/security-review.md). Adversarial review: [`docs/runbooks/adversarial-review.md`](docs/runbooks/adversarial-review.md). Onboard a repo: [`docs/runbooks/onboard-a-repo.md`](docs/runbooks/onboard-a-repo.md). Connect Claude to MCP: [`docs/runbooks/mcp-connector.md`](docs/runbooks/mcp-connector.md). GitHub Apps and project registration: [`docs/runbooks/github-app.md`](docs/runbooks/github-app.md).
