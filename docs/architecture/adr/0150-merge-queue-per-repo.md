---
title: Merge queue per repo, leased in the store; both merge entry points go through it
status: accepted (Andy, 2026-11-23)
date: 2026-11-23
amends: 0124 (merges serialised per repo), 0144 (the queue is the guard it names)
---

# 0150 — Merge queue per repo

AI-110: M5.18: Merge queue per repo. Andy, 2026-11-23 review: "build the merge queue; it replaces requiring up-to-date branches (AI-284: Require a PR to be up to date with main is cancelled, so the queue's own sync before each merge is the only guard)".

## Context and Problem Statement

`mergeVerdict` (ADR-0124) merges only a head that contains the latest default branch. But two PRs judged on the same `main` could both merge: the gate and MCP `merge_pr` (AI-220) each judged and merged on their own, and the API runs up to two instances. GitHub's native merge queue needs an organization-owned repo; these repos are user-owned.

## Considered Options

1. **A queue record per repo in the store, with a lease taken by compare-and-set.** No new infrastructure.
2. **An in-process lock.** Doesn't hold across instances.
3. **A Cloud Tasks queue per repo** (one task at a time). New infrastructure per repo, and still needs a store record for order.

## Decision Outcome

Option 1. `packages/domain/src/merge-queue.ts`, record `mergeQueues/{repo}`.

| Rule   | What it does                                                                                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry  | The gate and `merge_pr` offer a PR whose verdict is `merge`, or `wait` for `behind_default_branch` alone. Neither merges into a default branch any other way.                                                                                                                    |
| Order  | Oldest clean first: the time a PR was first offered. Only the first PR (the head) merges.                                                                                                                                                                                        |
| Lease  | Judging and merging the head happens under a lease on the record, written by compare-and-set (`version`). Another live lease: the caller returns, the holder carries on. A lease lasts 90 s; an expired one is taken over (logged).                                              |
| Sync   | A head behind the default branch gets one sync round per head, through the existing paths: a sync tick for agent PRs (ADR-0083), the re-sync workflow for the rest (ADR-0111). Main moving after each merge also triggers both.                                                  |
| Merge  | The head is re-judged with the full verdict (checks, both reviews, findings, mode) on its new head, the base tip is re-read, and the merge is pinned to the judged head. A head already clean and up to date merges with no extra round.                                         |
| Drop   | Failed checks, a cap, or a head that stops being clean leaves the queue. Failed checks and caps flag the PR's ticket (Andy's Needs-you inbox) with the reason. A refused merge on an unchanged head is dropped (the entry point already recorded it); a moved head stays queued. |
| Caps   | 20 PRs per repo, 3 sync rounds per PR, 60 minutes at the head, 5 heads per advance (ADR-0028).                                                                                                                                                                                   |
| Events | Webhooks the gate already receives move it: check runs and PR events on the head, main moving, and any event once the head is past its hold cap. `merge_pr` calls do too. No polling job.                                                                                        |

### Consequences

- Good: two control-plane merges can't be judged on the same `main`; `merge_pr` answers `queued` instead of asking the caller to retry.
- Good: no new infrastructure or index; the record is one document per repo.
- Bad: with no event in a repo, a stuck head isn't dropped until the next event there. Nothing else in that repo merges meanwhile, so nothing is lost.
- Bad: a session PR's sync depends on the re-sync workflow being on (`RESYNC_PRS`); off, the head is dropped after 60 minutes with a Needs-you note.
- Unchanged: merges by hand (Andy's) don't take the lease; the queue re-reads the base tip just before each merge, so it never merges on a stale verdict. Night merges into an epic branch don't go through it (AI-216: Merge modes: epic PR mode).
