# Sync tasks

When `main` moves, open agent PRs lacking it merge `main` (conflicts keep both sides), rerun checks, push (no rebase or force); one per PR at a time, 3 a day; global cap, not the dial; pause and quota apply. Conflicts or failing checks: Needs you, with files; no auto-merge while pending. Setup: runbook `agent-runs.md` §10

**How to use:** Automatic once Builds are on
