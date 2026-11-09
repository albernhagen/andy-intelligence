# 2026-11-09 — Dispatch caps (AI-66: Parallel runs under Andy's dial, caps and pause)

The one-run-per-project rule is gone. The build dispatcher now starts Ready tickets up to `mayDispatch` (ADR-0079: Dispatch caps) and stores why it stopped.

- Added: `runsAtOnce` (default 2, max 4), `paused`, `lastDispatch` on Project; global cap 4; 5 agent PRs waiting; MCP `set_runs_at_once` and `set_paused`; controls on `/projects`, a status line on the board and in MCP `status`.
- Beyond the brief, needed for it to hold: one run per ticket in `RunService.start` (concurrent dispatches could double-build above a dial of 1); a wake for projects idle on the global cap; a dispatch when a PR leaves review; `MAX_TICKETS_IN_FLIGHT` removed (it would have blocked a dial above 3); pause also stops auto-refine.
- For Andy: dispatch now reads quota readings, but the sanity checks in `docs/runbooks/quota.md` aren't built (threat model R24). Auto-refine still waits for an empty project, so a long Ready queue delays it.
