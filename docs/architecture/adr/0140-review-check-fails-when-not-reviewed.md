---
title: A review that should run and doesn't fails its check; a re-sync merge carries the verdict
status: proposed (AI-346; Andy decides at review)
date: 2026-11-21
amends: 0026 (an agent that could not run gave a neutral pass)
---

# 0140 — "Not reviewed" fails the review check; a re-sync merge carries the verdict forward

AI-346: Review agents skip PRs the re-sync bot updated, and the review checks still pass. Found on PR #343: after Re-sync open PRs (ADR-0111) merged `main` into the PR, both review agents refused to run, because claude-code-action rejects a run a bot starts. Both posted "not reviewed", and both checks were green.

## Context and Problem Statement

- ADR-0026 made an agent that couldn't run a neutral pass. So a PR with no review on its head looked mergeable. The coordinator caught it only by reading the comment.
- Every push the re-sync bot makes now loses both verdicts. Re-running the job doesn't help, because a re-run keeps the original actor. A person has to push again.

## Considered Options

1. **Carry the reviewed parent's verdict forward** when the bot's merge leaves the PR's own diff unchanged.
2. **Add the bot to the action's `allowed_bots`.** Every re-sync would get a full agent run, with no new code in the gate. But it spends quota on every re-sync (up to 12 an hour), the incremental diff would be all of `main`'s changes, and it would let a bot start an agent run that holds the Claude token.
3. **Leave it.** A person pushes an empty commit after each re-sync.

## Decision Outcome

Option 1, plus a failing check whenever a review should have run and didn't.

**Modes** (`scripts/review-gate.mjs`):

| Mode          | When                                                                                                              | Check                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `review`      | The agent ran                                                                                                     | Fails on unaccepted blocking findings          |
| `carried`     | The re-sync bot merged the base branch and the PR's diff is unchanged                                             | Passes, comment moves to the new head          |
| `skipped`     | Skip by design: docs-only (ADR-0030), draft, Dependabot                                                           | Passes                                         |
| `unavailable` | Should have run and didn't: no token, agent error or quota, invalid output, a re-sync commit that doesn't qualify | **Fails**, unless Andy adds the override label |

**Carry-forward** (`scripts/review-carry.mjs`) applies only when all of these hold:

1. The run was started by the re-sync bot (`github.actor`, set in the workflow) on a `synchronize` event.
2. The head is a merge whose first parent is the commit the previous verdict reviewed (`reviewed-sha`).
3. Its second parent is on the base branch.
4. The previous verdict passed (✅). An "accepted by label" pass doesn't count, since the label goes on every push.
5. The PR's own diff is byte-for-byte the same: `git patch-id --verbatim` of old base → reviewed commit equals new base → head. Whitespace counts.

If any of these fails, the result is `unavailable` and the check fails. So a bot commit that changes the PR's diff, adds anything besides a merge of the base, or sits on an unreviewed commit can't pass without a person pushing.

Why option 1 can't slip unreviewed changes in: the carried verdict covers exactly the diff the agent reviewed. The only new content is the base branch, which was already reviewed and merged. Option 2 would also review everything, but at a quota cost on every re-sync, and with a bot allowed to start agent runs.

### Consequences

- PRs updated by the re-sync bot keep their verdicts, at no quota cost. A re-sync whose merge changed the PR's diff fails the check until a person pushes.
- Repos without the Claude token, including the onboarding scratch repo, now fail both review checks until the token is set, or until Andy adds the label.
- Agent PRs (`agent/*`, opened and pushed by the control-plane App) never got a real review: the action refuses the App, and the check passed as neutral (e.g. PR #101). Now both checks fail on them, so they need a person's push or Andy's labels until the review action allows the App on agent PRs. That is a separate decision: AI-348: Review agents give agent PRs a real review. Project AI's `autoMerge` is `none`, so nothing merges on its own meanwhile.
- A quota outage now blocks merges instead of passing them. Andy's override label is the escape.
- CI still runs on the merged head, so a semantic clash between `main` and the PR is CI's to catch, as before.
