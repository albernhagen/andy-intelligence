---
title: Re-sync open PRs: the hourly cap is 12 and counts only runs that re-synced
status: accepted (Andy, 2026-11-25)
date: 2026-11-21
amends: 0111 (the hourly cap)
---

# 0139 — Re-sync's hourly cap: 12 runs that re-synced, counted from the branches

AI-345: Re-sync open PRs: raise the hourly cap to 12 and do not count skipped runs.

## Context and Problem Statement

ADR-0111 capped Re-sync open PRs at 4 runs an hour, counted from the Actions API. On 2026-11-21 `main` moved more often than that, and the first real run after `RESYNC_PRS` went on logged "6 runs in the last hour (cap 4): no re-sync": runs skipped while the switch was off counted. Capped runs count too, so on a busy day the job never re-syncs.

## Considered Options

1. **Count re-syncs on the branches:** the distinct `main` commits merged into open PRs by a merge of the default branch in the last hour. Each re-syncing run merges one `main` commit; skipped, capped and no-op runs merge nothing.
2. **Filter the Actions API's runs by conclusion.** Drops runs skipped by the switch, but a capped or no-op run still succeeds and counts.
3. **Record each re-sync somewhere** (a file, a label). A new write and a new place to keep in step.

## Decision Outcome

Option 1, with the cap at 12 (`MAX_RUNS_PER_HOUR`, `scripts/resync-prs.mjs`). The 13th re-sync in an hour is refused with a warning, before the write token is requested.

- Reads every eligible PR (not only this run's 20), since a PR re-synced this hour moves to the back of the queue.
- A hand merge of `main` (same message) counts too: the count can run high, never low, for open PRs.
- The Actions API is no longer read. The workflow still grants `actions: read`; removing it is a workflow change, so it is left for a separate PR.
- Other caps unchanged: 20 PRs a run, 3 merges of `main` per PR a day.
