---
status: accepted
date: 2026-11-08
amends: 0047 (who merges while a coordinator session runs the batch); AGENTS.md rule 2 (ask before touching `main`)
---

# 0078 — The coordinator merges low-risk PRs itself; medium and high stay with Andy

Decided by Andy, 2026-11-08: "Build it all out in parallel and auto-merge PRs that are low risk (and save medium/high for me) and have a way to summarize all the work for me into a digestible level when complete." Andy's merge of this ADR's PR is the authorisation a later reader can verify.

## Context and Problem Statement

`AGENTS.md` rule 2 says stop and ask before anything that touches `main`. With five or six worker PRs open at once (`platform/procedures/coordinate.md`), every merge waits on Andy and the batch serialises on him. The product's own gate (AI-34: M1.8b: Gate and auto-merge) is not built yet, and ADR-0047's supervisor is M2 work. The repo needs a rule a coordinator session can apply today, bounded so a wrong classification cannot reach anything that matters.

## Decision Outcome

A coordinator session may merge a PR itself only when **all** of these hold (the low-risk class):

| Condition | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checks    | Every check green on the head commit.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Reviews   | Both agents ran on that head and posted a verdict (`reviewed-sha` is the head) with no open `blocker`, should-fix, high or critical finding. A neutral check (agent skipped, unavailable or out of quota) does not count: docs-only PRs skip the agents (ADR-0030), so for them the coordinator reads the whole diff itself and records that in the merge record. A fix clears a finding; a reply does not. No `review-accepted` or `security-accepted` label. |
| Synced    | The latest `main` merged in, everything rerun after it. Procedural only: the ruleset does not require branches to be up to date.                                                                                                                                                                                                                                                                                                                               |
| Diff      | Confined to `apps/web`, `packages/domain`, `packages/store` read paths, read-only MCP tools, or these docs only: `README.md`, `docs/features.md`, `docs/build-log.md`, `docs/build-log/**`, `docs/architecture/history/**`. No `SCHEMA_VERSION` bump, migration, new entry point or credential.                                                                                                                                                                |
| Size      | S or M.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Never low risk, so Andy merges: `.github/`, `platform/**` (procedures, actions, baseline, executor), `scripts/executor-*`, `infra/`; auth or permissions; the dispatcher or gate; `packages/contracts` schemas the executor reads; Firestore rules or `SCHEMA_VERSION`; deploy or release paths; anything needing `terraform apply`; the agent rule files (`AGENTS.md`, `CLAUDE.md`, `docs/BUILD-PROMPT.md`, `.claude/**`), `context-budget.json`, `CODEOWNERS`, and every other file under `docs/`: `docs/security/**`, ADRs, `docs/architecture/*.md` (the design source of truth), `docs/runbooks/**` (steps Andy runs by hand), including `platform/procedures/coordinate.md` and the coordinating runbook: **the coordinator never merges a change to its own authority**. Any PR where a reviewer or the coordinator is unsure. When unsure, it is medium.

Enforcement today is procedural (this record, the procedure and the runbook), plus the `protect-main` ruleset's required checks (CI, both review agents; squash only) and CODEOWNERS requesting Andy's review on every PR; the product's gate (AI-34) makes the protected-path and review conditions mechanical. The threat model carries this authority as risk R23 and a boundary row in `docs/security/agents-and-executors.md`.

Mechanics: squash merge, one PR at a time, the remaining PRs re-sync and rerun before they are next; `main`'s checks after every merge; every merge recorded in the milestone digest (`docs/build-log/<date>-digest-<milestone>.md`: PR, ticket, class, who merged, review verdicts).

The product builds the same classification (AI-34: `would_auto_merge`, vetoes, protected paths, outcomes). Once the control plane's `autoMerge` is on for project `AI` (after AI-62's safe deploy path), this manual rule retires for that project.

## Consequences

- Good: docs and UI PRs no longer wait on Andy; the batch keeps moving while he reviews the medium and high ones.
- Bad: a wrongly classified PR reaches `main` without a human. The exclusions, "when unsure, medium" and the digest table bound and audit it. The threat model records that a compromised coordinator can merge only this class.
