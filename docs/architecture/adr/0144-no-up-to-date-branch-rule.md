---
title: protect-main does not require up-to-date branches; the merge queue syncs before each merge
status: accepted (Andy, 2026-11-23)
date: 2026-11-23
amends: 0124 ("GitHub enforces" row)
---

# 0144 — protect-main does not require up-to-date branches

Andy's decision in the 2026-11-23 product and architecture review. Recorded by AI-356: Record Andy's decisions: ADR-0096 and ADR-0124 accepted, up-to-date branches not required.

## Context and Problem Statement

ADR-0124: Merge modes says `protect-main` requires up-to-date branches. The ruleset never did (`strict_required_status_checks_policy: false` in `platform/baseline/github/ruleset-main.json`), and AI-284: Require a PR to be up to date with main was open to turn it on. With it on, every merge makes every other open PR stale: each one must sync and rerun all checks before it can merge.

## Decision Outcome

- **GitHub does not require a PR to be up to date with `main`.** The ruleset stays as it is. AI-284 is cancelled.
- **Why:** the rule slows every merge, and the cause it guards against (PRs falling behind `main`) is already handled: the re-sync workflow (ADR-0111: Re-sync open PRs on Actions when main moves) merges `main` into open PRs, and ADR-0138: Context budgets judges a PR on its own change, so a stale branch doesn't fail on drift it didn't cause.
- **ADR-0124's clean rule is unchanged.** `mergeVerdict` still merges only when the head contains the latest default branch. That is the product's check, not GitHub's.
- **The guard that replaces the rule** is the merge queue (AI-110: M5.18: Merge queue per repo): it syncs a PR with `main` before each merge.

## Recorded with this decision

ADR-0096: Managed repos call one executor was accepted the same day, on condition that agent tasks in different projects run in parallel. Verified: the executor's concurrency group is per agent task (`agent-run-${{ inputs.run_id }}` in `agent-run.yml`), and dispatch caps are 4 across projects (`MAX_ACTIVE_RUNS_GLOBAL`, `packages/domain/src/dispatch-caps.ts`) and `runsAtOnce` per project.

## Consequences

- Good: a merge doesn't block every other open PR.
- Bad: until the merge queue is built, a PR can merge on GitHub (by Andy or a coordinator) without the latest `main`. The gate's clean rule and the coordinator's "synced" step cover agent and coordinator merges; Andy's admin merges are his call.
