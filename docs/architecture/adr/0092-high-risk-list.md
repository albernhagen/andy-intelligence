---
status: accepted
date: 2026-11-11
amends: 0088 (the high-risk list)
---

# 0092 — The high-risk list a coordinator never merges, in full

Follows Andy's decision of 2026-11-11 (ADR-0088: the coordinator merges low- and medium-risk PRs). Both review agents found ADR-0088's list narrower than intended; ADR-0088 merged before the fix reached it, and ADR bodies are immutable, so the full list is recorded here. Andy's merge of this ADR's PR is the authorisation; the coordinator does not merge it.

## Context and Problem Statement

ADR-0088's high-risk table left out paths ADR-0078 had reserved for Andy without saying so: the review scripts, the gate's own file, dispatch caps, the contract schemas the executor reads, and docs-only changes to runbooks and design docs. It also let a ticket's PR carry a change to the coordinator's own rules as long as it had code in it, and three documents each restated the list.

## Decision Outcome

This table replaces ADR-0088's. Everything else in ADR-0088 stands. High risk, so **Andy merges**:

| Area             | What counts                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI and infra     | `.github/`, `infra/`, anything needing `terraform apply`, deploy or release paths, `platform/actions/**`, `platform/baseline/**`.                                                                                                                                                                                                                                                                                   |
| Access           | Sign-in, the allow-list, permissions (AI-19: One permission function), IAM; a new or changed credential or secret; an entry point that is unauthenticated or takes input from outside (webhooks, callbacks).                                                                                                                                                                                                        |
| Data             | Firestore rules, a `SCHEMA_VERSION` bump, a migration.                                                                                                                                                                                                                                                                                                                                                              |
| Review and merge | The review agents and what runs them: `platform/procedures/security-review.*`, `adversarial-review.*`, `threat-model.md`, `scripts/review-*.mjs`; the gate and its protected paths (`packages/domain/src/gate.ts`, AI-34: M1.8b: Gate and auto-merge); dispatch caps and the pause (ADR-0079); the executor sandbox: `scripts/executor-*`, `platform/executor/**`, `packages/contracts` schemas the executor reads. |
| Rules for agents | `AGENTS.md`, `CLAUDE.md`, `docs/BUILD-PROMPT.md`, `.claude/**`, `context-budget.json`, `CODEOWNERS`, `platform/procedures/coordinate.md`, runbook `coordinating-sessions.md`, and any ADR about who merges.                                                                                                                                                                                                         |
| Dependencies     | A new dependency, a major version jump, install `scripts` (ADR-0084 covers lockfile-only alert fixes).                                                                                                                                                                                                                                                                                                              |
| Decisions        | A docs-only PR that adds or changes an ADR, `docs/security/**`, `docs/runbooks/**` or `docs/architecture/*.md`. Inside a ticket's own PR these files may change only to record what that PR does; a PR that touches anything in the "Rules for agents" row, or loosens a rule in `docs/security/**`, is high risk whatever else it contains.                                                                        |
| Size and doubt   | Size L; a docs-only PR the coordinator has not read in full; anything the coordinator or a reviewer is unsure of.                                                                                                                                                                                                                                                                                                   |

The coordinator never merges a change to its own authority.

**Left out on purpose** (reserved for Andy by ADR-0078, medium now): the other agent procedures (`refine.md`, `plan.md`, `build.md`, `sync.md`, `inbox.md`) and scripts outside the rows above; dispatcher logic other than caps and the pause; a signed-in route added beside existing ones; and design docs or runbooks changed inside a ticket's PR. They get both review agents and, from AI-6: M1.17: Agent evals v1, the `agent-evals` check.

**One list.** This table is the list. `platform/procedures/coordinate.md` and runbook `coordinating-sessions.md` point here and do not restate it.

## Consequences

- Good: the review system, executor sandbox and the coordinator's own rules stay with Andy whatever else a PR contains; one list cannot drift from its copies.
- Bad: the list is still applied by hand (threat model R23, now high). The gate's protected paths (`packages/domain/src/gate.ts`) stay stricter (ADR-0078's list) until the `autoMerge` trial aligns them (R21).
