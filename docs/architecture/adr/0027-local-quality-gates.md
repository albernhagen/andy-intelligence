---
status: accepted
date: 2026-10-27
---

# 0027 — Local quality gates: lint and format before code leaves the machine

## Context and Problem Statement

CI runs lint, typecheck and tests, but only after a push. Agents and Andy should get the same feedback locally, immediately, so CI failures are rare and PRs stay clean.

## Decision Outcome

Same checks everywhere, cheapest first:

| When               | Runs                                                                                                          | How                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Agent edits a file | Prettier + ESLint `--fix` on that file                                                                        | Claude Code `PostToolUse` hook in the platform plugin / repo settings              |
| `git commit`       | Prettier, ESLint on staged files; `terraform fmt -check` on staged `.tf`; workflow linter on staged workflows | Git hook manager (lefthook proposed; builder verifies) installed by `pnpm install` |
| `git push`         | `pnpm typecheck` and `pnpm test`                                                                              | Same hook manager                                                                  |
| PR                 | Everything above plus build and security scans                                                                | CI (required checks)                                                               |

- Hooks are installed automatically by `pnpm install`; no manual setup.
- `--no-verify` is allowed for Andy in emergencies; CI still enforces everything.
- Lint rules live in one place (`eslint.config.js`, `.prettierrc.json`); hooks and CI call the same `pnpm` scripts.
- Managed projects get the same setup through the template (M4: Second project + epics + story board).

Lands in slice M1.12: Local quality gates.

### Consequences

- Good: fast feedback; fewer red CI runs; agents fix style before review.
- Bad: slightly slower commits/pushes; hooks need maintaining alongside CI.
