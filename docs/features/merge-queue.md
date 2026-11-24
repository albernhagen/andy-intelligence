# Merge queue per repo

Every merge the control plane makes into a repo's default branch, the merge gate's and MCP `merge_pr`'s, goes through that repo's merge queue (AI-110: M5.18, ADR-0150). Only one PR per repo merges at a time, oldest clean first. Before the next PR merges, it is synced with `main` (sync tasks for agent PRs, the re-sync workflow for session PRs) and its checks and both reviews must pass again on the new head. A PR already up to date and clean merges at once. If its checks fail after the sync, or it hits a cap (20 PRs per repo, 3 syncs, 60 minutes at the head), it leaves the queue and its ticket shows in Needs-you with the reason. The queue holds across both API instances: a lease on one stored record per repo, which expires so a crashed instance can't block it.

**How to use:** nothing to do. `merge_pr` answers `merged` or `queued` (with `queuePosition`, `queueNote`); the API logs each decision as `merge queue …` (component `merge-queue`).
