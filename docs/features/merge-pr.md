# MCP merge_pr

Coordinator sessions merge session PRs only through MCP `merge_pr` (AI-220, ADR-0124). The control plane reads the PR's facts from GitHub, applies `mergeVerdict` under the project's merge mode (or the ticket's stricter one) and squash-merges with the App's identity, pinned to the head it judged; otherwise it answers `wait` with every reason. A moved head or `main` doesn't merge. Each merge is recorded on the ticket (who asked, mode, verdict). Owner only; 30 calls per project per hour. Build agents' PRs stay with the merge gate; docs-only PRs (reviews skipped) and kept kinds wait for Andy. No queue: calls for one repo run in turn per instance, but overlapping calls across instances can both merge, so one call at a time until AI-110: M5.18: Merge queue per repo.

**How to use:** MCP `merge_pr` with `project`, `repo` and `number`; runbook [`coordinating-sessions.md`](../runbooks/coordinating-sessions.md) §5
