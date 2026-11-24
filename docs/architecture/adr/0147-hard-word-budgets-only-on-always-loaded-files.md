---
title: "Context budgets: hard limits only on files every session or agent step loads; the rest warn"
status: accepted (Andy, 2026-11-23)
date: 2026-11-23
amends: 0046 (which budgets fail CI), 0138 (applies to hard-limit files only)
---

# 0147 — Hard word budgets only on files every session or agent step loads; the rest warn

Andy's decision ("narrow") in the 2026-11-23 product and architecture review. Built by AI-362: Word budgets: hard limits only on files every agent loads; the rest warn.

## Context and Problem Statement

ADR-0046: Context budget gave every agent-facing doc a size budget that fails CI. By 2026-11-23, 187 files had budgets and 20 sat at or above 95% of theirs: every addition forced a deletion, and parallel PRs growing the same file collided. Most of those files are read on demand, so their size costs little. The budget matters where a file is loaded on every run.

Options in the review: keep all limits hard; drop budgets; **narrow**: hard limits only on always-loaded files.

## Decision Outcome

**Narrow.** An entry in `context-budget.json` may carry `"warn": true`.

| Entry            | Over its number in a PR                                                           | Locally (no base) | On `main` (`--report`) |
| ---------------- | --------------------------------------------------------------------------------- | ----------------- | ---------------------- |
| Hard (no `warn`) | Fails as ADR-0138 and ADR-0106 say: growth past half the room, or a new file over | Fails             | Warns, trim issue      |
| `warn: true`     | Passes; prints `WARN <path>: over its budget (<size>)`                            | Passes, same line | Warns, trim issue      |

**The hard-limit set** is what every session or every run of an agent step loads, read from the code (AI-362):

| File                                                                             | Loaded by                                                                                                            |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`, `**/AGENTS.md`, `**/CLAUDE.md`                                      | Every Claude Code session and agent step (auto-loaded; nested ones when working there; every procedure says read it) |
| `template/AGENTS.md.template`                                                    | Becomes every managed repo's `AGENTS.md`                                                                             |
| `platform/procedures/*.md`                                                       | Each agent step's prompt prefix (`scripts/executor-procedure.mjs`; review jobs via `agent-review-prepare`)           |
| `docs/build-log.md`, `docs/BUILD-PROMPT.md`, `docs/architecture/ARCHITECTURE.md` | Every building session (`AGENTS.md` "Every session", `BUILD-PROMPT.md` "Where things stand")                         |
| `docs/product/brief.md`                                                          | Every ideate, plan-project and onboard run, whole                                                                    |
| `docs/security/threat-model.md`                                                  | Every security-review run (a fixed input in `.review/`)                                                              |

Every other entry is warn-only. Numbers are unchanged; "trim, don't raise" still applies to every budget.

## Consequences

- Good: on-demand docs can grow without a forced deletion; parallel PRs stop colliding on them; the files that cost tokens on every run stay capped.
- Bad: warn-only docs can creep. The `main` trim issue still lists them, and the warning shows in each PR's check log.
- A new always-loaded file must be added without `warn` in the same PR.
