---
title: Re-sync open PRs on Actions when main moves
status: proposed (AI-147; Andy decides the token at review)
date: 2026-11-20
amends: 0083 (which PRs keep up with main), 0043 (TOKEN_POLICY gains a workflow)
---

# 0111 — Re-sync open PRs on GitHub Actions when main moves: GitHub's update-branch, clean merges only

AI-147: Re-sync open PRs on GitHub Actions when main moves, not on Andy's Mac. Epic AI-140: Parallel development without merge conflicts.

## Context and Problem Statement

Sync tasks (ADR-0083) keep agent PRs current. PRs opened by coordinator-run worker sessions get nothing: after each merge the coordinator runs `gh pr update-branch` by hand and, on a conflict, wakes the worker on Andy's Mac to merge `main`, run the suite and push. From 2026-11-12 to 2026-11-20 each merge left about ten PRs behind; the pre-push suites pushed the Mac's load to 380 and pushes failed for hours. It also stops when the laptop sleeps.

## Considered Options

| Option                                                                           | Clean merges | Conflicts                                                     | Cost and size                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Workflow on push to `main` calls GitHub's update-branch for each open PR** | yes          | a comment naming the files; the author merges                 | One small workflow and script. No Claude quota; GitHub does the merge                                                                                         |
| (b) Extend sync tasks to PRs that aren't agent PRs                               | yes          | the agent resolves "both sides added lines", like an agent PR | Sync tasks hang off a ticket's build run: worker PRs have none, so it needs a new PR model, executor path and publish rules; every sync spends a run of quota |

## Decision Outcome

**(a) now**, the smallest change that removes the manual step for clean merges. (b) is the later slice for conflicts (below).

- **Trigger:** `push` to `main` (and a manual run on `main`). Off until the repo variable `RESYNC_PRS` is `on`; setting it to anything else is the pause switch.
- **Which PRs:** open, into the default branch, head in this repo (never forks), not draft, not labelled `no-auto-sync`, not `agent/*` branches (sync tasks own them, so the two never race), not Dependabot's (it rebases its own). Least recently updated first.
- **How:** git computes the merge in memory (`git merge-tree`, objects only: no PR file is checked out and no PR code runs). Already contains `main`: nothing. Clean: `PUT /pulls/{n}/update-branch` with `expected_head_sha`, so GitHub makes a merge commit only if the head hasn't moved; never a rebase or force push. Conflict: no update; one comment on the PR (edited in place, not repeated) names up to 50 files. GitHub refusing for another reason (e.g. the App has no `workflows` permission and `main` changed a workflow): the same comment with GitHub's reason.
- **Caps (ADR-0028):** 4 runs an hour (counted from the Actions API; the fifth run does nothing), 20 PRs a run, 3 merges of `main` per PR in 24 hours (counted by GitHub's merge message on the branch, whoever made them). Pushes in a burst coalesce: a newer push cancels the older run, which the newer one covers.
- **Loop guard:** it runs only on pushes to `main`; its own writes are merges into PR branches, which never start it.
- **Fails closed:** a missing input, unreadable run count, failed fetch or refused token stops the run before the next PR, red in Actions. Nothing is written before every check for that PR passed.
- **Permissions** (job token): `contents: read` (check out `main`, fetch PR heads), `pull-requests: read` (list PRs and comments), `actions: read` (the hourly cap), `id-token: write` (the OIDC token for the write token). The writes, update-branch and the comment, use the write token below.
- **Write token:** an App repo token from `POST /github/token`, `TOKEN_POLICY` entry `resync-prs.yml@refs/heads/main` (1 hour, this repo, contents and pull requests write; no stored secret, ADR-0043). A push made with the job's `GITHUB_TOKEN` starts no workflows, so the updated PR would have no checks or reviews and couldn't merge; an App token's push starts them. **This is Andy's call** (question in the PR); the PR carries the recommended option.
- **Carried by:** composite action `platform/actions/resync-prs` and the `no-auto-sync` label (§8.1). Managed repos don't get the caller yet: they need a token rule per registered project.

### Later slice: conflicts

Route a conflicted, opted-in PR to a sync task (option b) that resolves only "both sides added lines" conflicts, regenerates generated files and pushes after the executor's checks; anything else keeps the comment. That needs a sync-task trigger that isn't a ticket's build run.

### Consequences

- Good: clean merges need nobody, cost no Claude quota for the merge, and don't depend on Andy's Mac. The coordinator's per-merge round is gone except for conflicts.
- Bad: each re-sync reruns CI and both review agents on that PR (R8): at worst 4 × 20 an hour, 3 per PR a day. A worker still on the branch must pull (merge, not rebase) before its next push.
- Bad: conflicts still go to a person (the PR's author) until the later slice. The ticket's "pause and quota" criterion is met by the repo variable, not the control plane's pause switch.
- Accepted: a change merged into this workflow or script runs with the write token, like any code on `main` (policy and code changes need a PR; Andy merges high risk).
