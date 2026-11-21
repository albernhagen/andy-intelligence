# 2026-11-20 — AI-124: M4.21: Night: merge stories into the epic branch and open the morning PR

Built against ADR-0107 (proposed): a night story merges into its launch's `epic/<KEY>` and moves to Done there; one PR to `main` opens when the launch ends.

- Gate (`gate-service.ts`): `gate.ts` unchanged. A story PR into the active launch's epic branch merges when `not_default_branch` is the only reason, whatever `autoMerge` says; CODEOWNERS and required checks come from the default branch. `EpicMerges` (`night-merge.ts`) picks the PRs from stored facts only and merges each story once (≤ 50 per launch). Bookkeeping that fails after a merge flags the story and is redone from the PR's close webhook; a morning PR that fails flags the epic.
- Morning PR (`MorningPullRequests`): called when a launch ends, from `BuildDispatcher` and `NightLaunches.end` (both optional constructor arguments). No merge: no PR, and the branch is deleted if nothing new is on it.
- Contracts: `Run.epicMerge` (time, squash sha); `CodeHost.mergePullRequest` now resolves to the squash commit's sha. GitHub adapter: `openEpicPullRequest`, `deleteEpicBranch` (epic refs only).
- Wired: the webhook gate gets `EpicMerges` when night launches are stored. Not wired: the morning opener, since nothing in the API ends launches yet (AI-120: M4.17 wires launches); `ConnectedCodeHost` lacks the branch methods, as for AI-122.
- Sync runs already skip PRs not into the default branch, so story PRs never merge `main` into themselves (AI-122's hand-over concern).
