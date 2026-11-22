---
title: "Context budgets: a PR is judged on its own change; an over-budget main opens a trim issue"
status: proposed (AI-344; Andy approved the plan 2026-11-21, decides at review)
date: 2026-11-21
amends: 0046 (what fails CI), 0106 (half the room, kept)
---

# 0138 — The budget check judges a PR's own change; `main` over budget warns and opens one trim issue

AI-344: Context budgets: check a PR's own change; an over-budget main opens a ticket instead of failing CI.

## Context and Problem Statement

On 2026-11-21 `main` went red twice: several PRs, each inside a doc's budget, merged together and pushed a file a few words over (`template-and-baseline.md` 1602/1600, `domain-and-ports.md` 1206/1200). Nothing was broken, but `check` then failed on `main` and on every open PR until someone trimmed the file. ADR-0106's half-the-room rule stops two PRs overflowing a file, not three. Andy chose this over requiring up-to-date branches (AI-284, parked).

## Considered Options

1. **Judge a PR against its base; on `main` warn and record a trim.** Nobody is blocked by a file they didn't grow; the trim is still tracked.
2. **Require PRs to be up to date with `main`.** Every merge makes every other PR re-run first (AI-284).
3. **Smaller allowances (a third, a quarter of the room).** Still overflows with enough PRs, and starves real edits.

## Decision Outcome

Option 1. Budgets are never raised by it.

| Where                                   | Fails when                                                                                                                                        | Otherwise                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A PR (a base is known)                  | It grows a file past half the room left on the base (none left on a file already over, so any growth there fails), or adds a new file over budget | A file over on the base that the PR didn't grow prints a `NOTE`; a PR that trims it passes                                                                                                |
| A push to `main` (`--report`)           | Never                                                                                                                                             | Each file over gets a `::warning::` and a job-summary row; the `context-budget-trim` job keeps one GitHub issue naming each file, its size and budget, and closes it when nothing is over |
| Locally (`pnpm context:check`, no base) | Any file is over                                                                                                                                  | Unchanged: every file over is listed                                                                                                                                                      |

- **Issue, not a ticket:** a GitHub issue needs only the job's `GITHUB_TOKEN` with `issues: write`. A ticket would need a new control-plane endpoint and an OIDC token flow.
- **Trust:** the issue job runs only on pushes to `main`, on `main`'s code, never on a PR. Caps: one issue; at most 3 pages of open issues read.
- **Managed projects** get both through the baseline's `ci.yml` and `platform/actions/ci-check` and `context-budget-trim` (ADR-0038).
