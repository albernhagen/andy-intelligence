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
```

### Quality gates (ADR-0027)

`pnpm install` installs the git hooks ([lefthook](https://lefthook.dev), `lefthook.yml`):

| Hook       | Runs on staged files                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| pre-commit | `prettier --check`, `eslint`, `terraform fmt -check`, actionlint (skipped if absent) |
| pre-push   | `pnpm typecheck`, `pnpm test` (whole repo)                                           |

Claude Code runs `scripts/format-edited-file.mjs` after each Edit/Write (`.claude/settings.json`): Prettier + ESLint `--fix` on that file; unfixable lint errors go back to the agent. CI runs the same checks plus build and actionlint. Formatting failure on commit: `pnpm format`, re-stage. `--no-verify` is for emergencies only.

### Security checks on PRs (ADR-0025, ADR-0030)

| Check                                                | Workflow              | Fails on                                                                                        |
| ---------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| `trufflehog`                                         | `secret-scan.yml`     | Verified or unverifiable secrets                                                                |
| `codeql (javascript-typescript)`, `codeql (actions)` | `security-scans.yml`  | Code scanning alerts, high or higher (ruleset)                                                  |
| `dependency-review`                                  | `security-scans.yml`  | New dependency with a high/critical advisory                                                    |
| `terraform-misconfig`                                | `security-scans.yml`  | Trivy HIGH/CRITICAL in `infra/`                                                                 |
| `security-review`                                    | `security-review.yml` | Agent finding high/critical, unless labelled `security-accepted` (docs-only PRs skip the agent) |

Weekly + manual: `system-security-review.yml` opens a PR updating the threat model. Action pins are commit SHAs, bumped by Dependabot.

Run locally (needs a Firebase project for sign-in):

```sh
GCP_PROJECT_ID=andy-intelligence-512400 ALLOWED_EMAILS=you@example.com \
FIREBASE_API_KEY=... FIREBASE_AUTH_DOMAIN=andy-intelligence-512400.firebaseapp.com \
pnpm --filter @andy/api dev          # :8080
pnpm --filter @andy/web dev          # :5173, proxies /api to :8080
```

## Layout

| Path                  | What                                                         |
| --------------------- | ------------------------------------------------------------ |
| `apps/api`            | Hono API (later MCP, webhooks, jobs); serves the SPA         |
| `apps/web`            | React + Vite + shadcn UI                                     |
| `packages/contracts`  | Zod entities, ports, fakes, contract suites                  |
| `packages/store`      | Firestore client + Zod-validated converters                  |
| `infra/bootstrap`     | One-time GCP bootstrap (state bucket, GitHub OIDC)           |
| `infra/control-plane` | Control-plane GCP resources                                  |
| `infra/billing`       | Billing budget + alerts (local plans only)                   |
| `scripts`             | Repo tooling (Claude Code format hook, security-review gate) |
| `platform/procedures` | Agent procedures: `/security-review`, `/threat-model`        |
| `lefthook.yml`        | Git hooks: pre-commit lint/format, pre-push checks           |

Infra setup: [`docs/runbooks/m0-setup.md`](docs/runbooks/m0-setup.md). Budget and cost caps: [`docs/runbooks/billing.md`](docs/runbooks/billing.md). Security review setup: [`docs/runbooks/security-review.md`](docs/runbooks/security-review.md).
