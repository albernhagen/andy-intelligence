# Coordinator tools

Scripts a coordinator session uses to run parallel workers: `survey` (each PR's head, sync with `main`, checks, review verdicts on the head, high-risk paths), `merge-queue` (merges listed PRs one at a time, only when clean, and waits for `main`), `resync` (merges `main` into a PR branch, resolving only add-only conflicts) and `host-check` (is the Mac awake and not overloaded). The pre-push hook runs only the tests a push can affect; CI runs the full suite.

**How to use:** `node scripts/coordinator/<tool>.mjs --help` ([runbook](../runbooks/coordinating-sessions.md) §6)
