---
title: Hold control-plane merges while the default branch is red
status: proposed
date: 2026-11-25
amends: 0124 (one more wait reason in the merge verdict), 0150 (the queue holds instead of dropping)
---

# 0154 — Hold merges while main is red

AI-382: Hold merges while main is red. Proposed as P3 by spike AI-364 (`docs/spikes/AI-364.md`); Andy approved building it on 2026-11-25.

## Context and Problem Statement

The merge gate, MCP `merge_pr` and the merge queue (ADR-0150) judge a PR's own checks, never the default branch's. When a merge breaks `main`, they keep merging onto it; the break only shows later, as PR checks failing after a sync. A coordinator session checks `main` by hand. A managed project has no coordinator, so nothing would stop.

## Considered Options

1. **One more fact in `mergeVerdict`**: the default branch's required checks on its tip, read where the other facts are read; a `failed` state is wait reason `main_red`. The queue holds on it; webhooks wake it.
2. **A stored "main is red" flag set by webhooks**, read by each caller. A second source of truth that can go stale, and each caller needs its own rule.
3. **A polling job on `main`'s checks.** Costs reads while idle; the queue already moves on events.

## Decision Outcome

Option 1.

| Rule           | What it does                                                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What counts    | The default branch's required checks (its branch rules), minus the two review checks (they run on PRs only), on the tip the verdict judges the PR against. `mainChecksOf` in `merge-facts.ts`.                                                                                                                                           |
| Red            | Every run of a required check has completed and one didn't pass (`success`, `neutral`, `skipped` pass). Wait reason `main_red`, with the failing check names.                                                                                                                                                                            |
| Not red        | A required check still running, queued or not reported yet; a re-run of a failed check counts as running. A push that moves `main` judges the new tip.                                                                                                                                                                                   |
| Unknown        | A read that fails or a listing cut short with no failure in it: wait reason `main_checks_unknown` (fail closed); the queue treats it as pending.                                                                                                                                                                                         |
| One rule       | The gate, `merge_pr` and the queue all judge through `mergeVerdict`; none has its own rule.                                                                                                                                                                                                                                              |
| Queue          | A held PR joins the queue (or keeps its place) and waits: not merged, not synced (that would pull the break in), not dropped. `held` comes before `failed`: a PR's checks may fail only because the red `main` reached it. Its own 60-minute hold cap is paused while held.                                                              |
| Release        | The first judgement in the repo that shows `main` not red clears the hold and the queue goes on, unasked. A completed check run wakes a held queue (main's checks name no PR), at most once a minute (`MAIN_RED_WAKE_MS`, ADR-0028: anyone who can push a branch can make check runs); a push to `main` or a merge does too. No polling. |
| Cap (ADR-0028) | Held for more than 30 minutes (`MAX_MAIN_RED_HOLD_MS`): one Needs-you note on the queue head's ticket names the failing checks. Once per red spell; a new spell starts the clock again. Thirty minutes lets a flaky check re-run; longer, a real break in a project with no coordinator waits too long for Andy.                         |
| Per repo       | The hold lives on the repo's queue record (`mergeQueues/{repo}`, field `mainRed`), so one repo's red `main` never holds another's.                                                                                                                                                                                                       |
| Shown          | The digest lists `merge_held` as an exception with the failing checks; MCP `status` (no key) lists `mergeHolds`. Logs: `merge queue hold main_red`, `merge queue main_red past cap`, `merge queue release main_red` (component `merge-queue`).                                                                                           |

### Consequences

- Good: a managed project stops merging onto a broken `main` with no coordinator; the queue resumes on its own.
- Good: the truth is read from the code host at each judgement; the stored hold only records when it began and whether Andy was told.
- Bad: each judgement into a default branch costs two more host reads (required checks, the tip's checks).
- Bad: the PR that fixes `main` is held like any other. Fixing `main` is Andy's merge on GitHub, or a re-run of a flaky check.
- Bad: the cap is checked on the next event in the repo; with no event, the note waits for one. With no PR queued there is no hold to raise.
- Unchanged: Andy's merges on GitHub are not blocked. Epic-branch and night merges don't change the default branch, so they don't hold: a PR not into the default branch skips the read.
