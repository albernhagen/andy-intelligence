---
title: The review agents run on agent PRs the App pushes
status: proposed (AI-348; Andy decides at review)
date: 2026-11-21
amends: 0140 (agent PRs failed closed)
---

# 0141 — The review agents run on agent PRs: the App is allowed on `agent/*` branches only

AI-348: Review agents give agent PRs a real review.

## Context and Problem Statement

Agent PRs come from the control-plane App (`andy-intelligence-control[bot]`), which opens and pushes branches named `agent/*`. claude-code-action refuses runs a bot starts, so neither review agent ever ran on an agent PR. Their checks passed as neutral "not reviewed" (e.g. PR #101). Since ADR-0140 they fail. But agent PRs need a real review most: they're the ones that can merge on their own (ADR-0050, R21).

## Considered Options

1. **Allow the App in the review action only when it started the run on an `agent/*` branch.**
2. **`allowed_bots` set to the App everywhere.** The App also re-syncs other PRs (ADR-0111). That would spend quota on every re-sync and bypass ADR-0140's carry-forward.
3. **`allowed_bots: '*'`.** The action warns that on a public repo, other Apps could start runs with prompts they control.

## Decision Outcome

Option 1. `agent-review-prepare` sets its `allowed-bots` output to the App's login only when all of these hold:

- the run's `github.actor` is the configured `agent-bot`;
- the PR's head branch starts with `agent-branch-prefix` (`agent/`).

Both workflows pass that output to the action's `allowed_bots`. Every other bot-started run gets `""` and stays refused, so it fails closed (ADR-0140). Re-sync pushes to other PRs keep using carry-forward, and an agent PR skips carry-forward because it gets a real review.

The review agent sees only what any PR gives it: the diff and comments as untrusted data, Read/Glob/Grep, and no shell. The job doesn't run PR code. Agent builds can't change `.github/` or the review scripts, because the publish job refuses those paths (R2).

### Consequences

- Every push the App makes to an agent PR gets both reviews, including sync merges of `main`. Agent PRs are capped by the build and sync caps.
- A person pushing to an `agent/*` branch is reviewed as before. Another App or bot on that branch still fails closed.
- Managed repos get it with the next baseline pin; `agent-bot` names their App.
