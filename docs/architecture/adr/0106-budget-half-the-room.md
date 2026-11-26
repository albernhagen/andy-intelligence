---
title: "Context budgets: a PR uses at most half the room"
status: superseded by 0138
date: 2026-11-20
amends: 0046 (what a PR may do to a budgeted doc)
---

# 0106 — A PR may use at most half the room left in a budgeted doc it grows

AI-143: Context budgets: two passing PRs can't push main over (epic AI-140: Parallel development without merge conflicts).

## Context and Problem Statement

`main` doesn't require PRs to be up to date before merging, so each PR's `pnpm context:check` sees `main` as of its last push. Two PRs that each fit a budget could push `main` over together; it broke `main` three times in a week.

## Considered Options

1. Require PRs to be up to date (ruleset strict mode): every merge re-runs CI and both review agents on every open PR.
2. A merge queue: `merge_group` support in every required workflow and a new merge path for the gate.
3. Re-check every open PR on each push to `main`: a new workflow with `statuses: write` and a ruleset change.
4. A fixed headroom (5% of the budget): blocks growth on the 20 files already inside it.
5. A PR may use at most half the room left in a file it grows.

## Decision Outcome

Option 5.

- A PR that grows a budgeted file that exists on its base branch may add at most `floor((budget − size on base) / 2)` words (or lines). Files new in the PR are exempt: two PRs can't add one path without a conflict.
- `scripts/context-budget.mjs` checks it in the `check` job against `origin/$GITHUB_BASE_REF` (fetched by the script), or `--base <ref>` locally. Pushes to `main` check budgets only, so the rule never fails `main` itself.
- A base that can't be fetched fails the check; a repo whose CI can't fetch it (private, no credentials) sets `CONTEXT_BUDGET_BASE=none`.
- Budget values are unchanged.

### Consequences

- Good: any two PRs growing one file fit together: base + a + b ≤ budget. Trims are never blocked.
- Bad: three or more PRs growing one file at once can still overshoot, by at most half the room. A file near its budget allows only small growth, so a PR may have to trim first.
