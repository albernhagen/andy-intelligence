# Merge gate

Per PR or check webhook, judges agent PRs on GitHub facts, not PR text. Vetoes: no verification output, protected or tooling paths, spike code outside `docs/`, a failing required or review check. Then `mergeVerdict` under the project's saved merge mode (ADR-0124): up to date with `main`, no accepted label, no open finding on the head, no kept path, no high-risk path in `low-risk`; unknown means wait; no mode saved, nothing merges (ADR-0134). Records mode and verdict per task; squash-merges once per head; failed merges flag the ticket; close records outcome, metrics

**How to use:** Project settings → Merge mode, or MCP `set_merge_mode` (tighten only)
