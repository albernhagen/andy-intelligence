# andy-intelligence

Personal control plane for agentic software development: ideas → refined tickets → agent runs (Claude Code, Jules, OpenCode) under cost and quota controls → PRs → dev → one-click prod.

## Docs

| Doc                                                                      | What                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) | Design and milestone/slice plan — source of truth           |
| [`docs/architecture/adr/`](docs/architecture/adr/)                       | Architecture decisions (MADR)                               |
| [`docs/build-log.md`](docs/build-log.md)                                 | Slice status, pending decisions, blockers                   |
| `docs/security/threat-model.md` (from M1.10: Security review automation) | Threat model and open security risks                        |
| [`docs/runbooks/`](docs/runbooks/)                                       | Manual steps (setup, secrets, apply)                        |
| [`AGENTS.md`](AGENTS.md)                                                 | Rules for agents working in this repo (`CLAUDE.md` symlink) |
| [`docs/BUILD-PROMPT.md`](docs/BUILD-PROMPT.md)                           | Session prompt for the building agent                       |

Docs ship with the change: a PR that changes commands, layout, design, or a decision updates the matching doc (ARCHITECTURE §14, ADR-0022).

## Develop

Tools: Node from `.nvmrc`; Terraform from `.terraform-version` via [tenv](https://github.com/tofuutils/tenv) (`brew install tenv`).

```sh
pnpm install
pnpm test        # vitest, all packages
pnpm typecheck
pnpm lint
pnpm build
```

Run locally (needs a Firebase project for sign-in):

```sh
GCP_PROJECT_ID=andy-intelligence-512400 ALLOWED_EMAILS=you@example.com \
FIREBASE_API_KEY=... FIREBASE_AUTH_DOMAIN=andy-intelligence-512400.firebaseapp.com \
pnpm --filter @andy/api dev          # :8080
pnpm --filter @andy/web dev          # :5173, proxies /api to :8080
```

## Layout

| Path                  | What                                                 |
| --------------------- | ---------------------------------------------------- |
| `apps/api`            | Hono API (later MCP, webhooks, jobs); serves the SPA |
| `apps/web`            | React + Vite + shadcn UI                             |
| `packages/contracts`  | Zod entities, ports, fakes, contract suites          |
| `packages/store`      | Firestore client + Zod-validated converters          |
| `infra/bootstrap`     | One-time GCP bootstrap (state bucket, GitHub OIDC)   |
| `infra/control-plane` | Control-plane GCP resources                          |

Infra setup: [`docs/runbooks/m0-setup.md`](docs/runbooks/m0-setup.md).
