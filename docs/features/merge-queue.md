# Merge queue per repo

Every control-plane merge into a default branch (the gate, MCP `merge_pr`, Andy's Merge button) goes through that repo's queue (ADR-0150). One PR per repo merges at a time, oldest clean first. The next PR is synced with `main` (sync tasks for agent PRs the gate queued; otherwise the queue, by GitHub's update-branch with the App's identity, AI-388), then its checks and both reviews must pass again. A conflict, failed checks or a cap (20 PRs per repo, 3 syncs, 60 minutes) drops it into Needs-you; no longer clean: a ticket comment. A lease on one stored record per repo holds it across both instances.

**While `main` is red** (AI-382, ADR-0154): PRs wait (`main_red`) and merge once it passes. Over 30 minutes: one Needs-you note. Shown in the digest and MCP `status`.

**Merge button** (AI-388, ADR-0157): in Needs-you and the ticket panel (Ready for review). Andy's click waives only what the mode keeps for him (kept and high-risk paths, the mode, his accepted label), pinned to the PR's diff: a new change drops it ("click Merge again"). `merge_pr` follows the mode.

**How to use:** the Merge button; it and `merge_pr` answer `merged`, queued with its place and note, or what holds it. Logs: `merge queue …` (component `merge-queue`).
