---
title: Night story merges into the epic branch, Done there; one morning PR
status: proposed (AI-124; Andy decides at review)
date: 2026-11-20
amends: 0049 (how "Epic branch" and "Morning review" are built), 0056 (which merge completes a ticket)
---

# 0107 — A night story merges into its epic branch and is Done there; the morning PR opens at the launch's end

AI-124: M4.21: Night: merge stories into the epic branch and open the morning PR.

## Context and Problem Statement

ADR-0049 says a night launch's stories merge into `epic/<KEY>` once their checks and both review agents pass, dependants build on it, and one PR `epic/<KEY>` → `main` waits for Andy in the morning. AI-122 made launched stories build on and target the epic branch. Three things were open:

| Question                           | Why it matters                                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What the gate says                 | `decideGate` vetoes every PR not into the default branch (`not_default_branch`), and `epic/*` has no branch rules: `listRequiredChecks` is empty, so the gate would also say `no_required_checks`.                                                              |
| When a merged story counts         | Only a merge into the default branch moves a ticket to Done (ADR-0056). Dependants wait for their blockers to be Done, and the launch ends `done` only when every story is Done or Cancelled, so without a move nothing after the first story would ever start. |
| What a launch with no merge leaves | An empty `epic/<KEY>` branch.                                                                                                                                                                                                                                   |

## Decision Outcome

| Piece      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate       | `gate.ts` is unchanged. A story PR may merge into the epic branch only when `not_default_branch` is the gate's **only** reason; every other veto holds. Its CODEOWNERS and required checks are read from the **default branch**, so it needs what a merge into `main` needs. `wouldAutoMerge` stays false: it means "into the default branch".                                                                                                                                                    |
| Which PRs  | Facts from stored records only: the project's active launch (running or stopping), its recorded `epicBranch`, the PR's base equal to it and to the build run's `baseBranch`, the ticket among the launch's `storyKeys`, in In progress or Ready for review. The `autoMerge` policy doesn't apply: nothing reaches `main`.                                                                                                                                                                         |
| Merge      | As today: squash with the App token, pinned to the assessed head, one attempt per head; a failure flags the story. The run records `epicMerge` (time, squash commit sha).                                                                                                                                                                                                                                                                                                                         |
| Done       | The merged story moves to Done (amends ADR-0056 for night stories only), so dependants start on the epic branch and the launch can end. The epic stays open; the morning PR into `main` links to it.                                                                                                                                                                                                                                                                                              |
| Bound      | Once per story, checked against the merges recorded on its runs (not its stage), so a story whose move to Done failed never merges twice. A launch has at most `NIGHT_LIMITS.maxStories` (50) stories, so at most 50 merges.                                                                                                                                                                                                                                                                      |
| Morning PR | When the launch ends (the dispatcher or `NightLaunches.end`), one PR `epic/<KEY>` → default branch, titled `<epic key>: <epic title> (overnight)`, description starting with the epic's link, then each merged story's commit range (previous tip..its squash commit) and PR link. Only keys, links and shas: no ticket or PR text. Its head isn't an agent branch, so the gate never merges it. If it can't be opened, the epic is flagged Needs-you: nothing retries once the launch has ended. |
| No merge   | No PR; `epic/<KEY>` is deleted if its tip is still the launch's starting commit. A reused branch holding an earlier night's work is kept.                                                                                                                                                                                                                                                                                                                                                         |

### Consequences

- Good: the night runs as ADR-0049 describes; the gate's rules and its file stay as they are; Andy reviews one PR per launch.
- Bad: a story is Done before its code reaches `main`. If Andy closes the morning PR, its stories stay Done; he moves them back by hand.
- Bad: two story PRs that conflict on the epic branch: the second merge fails and its story is flagged, not synced (syncs only merge the default branch).
