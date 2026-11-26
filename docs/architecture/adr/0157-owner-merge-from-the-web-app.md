---
title: Andy merges from the web app through the merge queue; PR sync is a project setting
status: proposed
date: 2026-11-26
amends: 0124 (Andy's click waives what the mode keeps for him), 0150 (the queue syncs session PRs itself), 0111 (re-sync runs only when a project's PR sync is `all`)
---

# 0157 — Andy merges from the web app; PR sync is a project setting

AI-388: Merge from the web UI through the merge queue; PR sync becomes a project setting. Andy, 2026-11-26: turn blanket re-sync off and merge through the queue, and "it should just be a project setting in the UI". On 2026-11-25 he confirmed both parts, and that only the web app's click waives the mode.

## Context and Problem Statement

After each merge the re-sync workflow (ADR-0111) merges `main` into every open PR, so with eight PRs open one merge reruns seven CI suites. The merge queue (ADR-0150) syncs only the PR that is next, but Andy merges by clicking in GitHub, which skips it. `merge_pr` can't stand in: it follows the merge mode, so the kinds the mode keeps for Andy (kept paths, high risk, `manual`) never merge through it. Coordinator sessions call `merge_pr` with Andy's MCP grant, as the same user, so `merge_pr` can't tell Andy from a session.

## Considered Options

1. **A Merge button in the web app, through the queue, with the click as Andy's approval; PR sync a project setting the workflow reads by its OIDC token.**
2. **The same approval over MCP `merge_pr` too.** Any session holding Andy's MCP grant could then merge kept-path and high-risk PRs, which ADR-0088 and ADR-0124 keep for Andy.
3. **Keep merging in GitHub; only switch re-sync off.** Andy's merges still skip the queue, and session PRs behind `main` would then never be synced (ADR-0150 relied on the workflow).

## Decision Outcome

Option 1.

| Rule            | What it does                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who             | `POST /api/projects/{id}/merges`: behind the `/api` sign-in (Firebase ID token, allow-list), and `requireCan(merge_pr)` again in the service. The MCP grant doesn't reach `/api`, so no session or agent can send it.                                                                                                                |
| What it waives  | `ANDYS_MERGE_REASONS` only: no mode saved, `manual` or `epic` mode, kept path, high-risk path, accepted label. Checks, both reviews, open findings, Ready for review, every unknown fact and a red `main` still hold the PR, and the answer names them.                                                                              |
| Pinned          | The approval is stored on the queue entry with the PR's own diff (`CodeHost.diffDigest`: paths and patches, hunk line numbers left out). A later head keeps it only while that diff is the same (the queue's sync of `main`); any new change drops the PR with a note to click again. A diff the host can't show in full is refused. |
| Agent PRs       | The button may merge a build agent's PR the gate left for Andy ("Merges waiting"); `merge_pr` still refuses those.                                                                                                                                                                                                                   |
| Sync            | The queue syncs its head itself: GitHub's update-branch with the App's identity, pinned to the head it judged. A conflict drops the PR into Needs-you. Bounded by the queue's caps (one sync per head, 3 per PR, 60 minutes).                                                                                                        |
| PR sync setting | `Project.prSync`: `queue` (default) or `all`. Change log, revert, Settings picker, MCP `set_pr_sync`.                                                                                                                                                                                                                                |
| Workflow reads  | `POST /github/pr-sync` with the job's existing Actions OIDC token: only the repo's own `resync-prs.yml` on `main`, in a repo registered to an enabled project, gets `{ prSync }`. `queue` ends the run before any write token is asked for. No new credential. `RESYNC_PRS` stays the pause switch.                                  |
| Caps (ADR-0028) | The button shares `merge_pr`'s 30 calls per project per hour; `/github/pr-sync` 30 reads per instance per minute.                                                                                                                                                                                                                    |

### Consequences

- Good: one merge reruns one PR's checks; Andy's merges get the queue's sync, re-check and serialisation.
- Good: no new credential, workflow permission or infrastructure.
- Bad: a session driving Andy's signed-in browser could click Merge. Agents' rules forbid acting in Andy's browser beyond the task; the risk is recorded (R-AI-388).
- Bad: with `queue`, a PR not in the queue goes stale until it is next; merging it by hand in GitHub skips the sync (GitHub doesn't require up-to-date branches here, ADR-0144).
- Unchanged: Andy can still merge in GitHub; the gate's merges and night merges into epic branches.
