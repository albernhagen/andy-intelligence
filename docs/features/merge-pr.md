# MCP merge_pr

Coordinator sessions merge session PRs only through MCP `merge_pr` (AI-220, ADR-0124). The control plane reads the PR's facts from GitHub, applies `mergeVerdict` under the project's merge mode (or the ticket's stricter one) and squash-merges with the App's identity, pinned to the head it judged; otherwise it answers `wait` with every reason. A clean PR (or one clean but behind) goes into the repo's merge queue ([merge-queue.md](merge-queue.md)) and merges as its head, after a sync when behind; the call answers `merged`, or `queued` with its place. Each merge is recorded on the ticket (who asked, mode, verdict). Owner only; 30 calls per project per hour. Build agents' PRs stay with the merge gate; docs-only PRs (reviews skipped) and kept kinds wait for Andy.

**How to use:** MCP `merge_pr` with `project`, `repo` and `number`; runbook [`coordinating-sessions.md`](../runbooks/coordinating-sessions.md) §5
