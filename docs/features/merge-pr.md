# MCP merge_pr

Coordinator sessions merge session PRs only through MCP `merge_pr` (AI-220, ADR-0124). The control plane reads the PR's facts from GitHub, applies `mergeVerdict` under the project's merge mode (or the ticket's stricter one) and squash-merges with the App's identity, pinned to the head it judged; otherwise it answers `wait` with every reason. A clean PR (or one clean but behind) goes into the repo's merge queue ([merge-queue.md](merge-queue.md)) and merges as its head, after a sync when behind; the call answers `merged`, or `queued` with its place. Each merge is recorded on the ticket (who asked, mode, verdict). Owner only; 30 calls per project per hour. Build agents' PRs stay with the merge gate; docs-only PRs (reviews skipped) and kept kinds wait for Andy.

**How to use:** MCP `merge_pr` with `project`, `repo` and `number`; runbook [`coordinating-sessions.md`](../runbooks/coordinating-sessions.md) §5

**GitHub backs it up** (AI-217): `.github/CODEOWNERS` lists the kept paths and `protect-main` requires a code owner's approval on them with no App bypass, so GitHub itself should refuse the App's merge of a kept kind (expected: GitHub's docs don't spell out code-owner review with zero required approvals; the runbook check confirms it after apply); Andy merges those with his admin bypass (runbook [`onboard-a-repo.md`](../runbooks/onboard-a-repo.md) §1b).
