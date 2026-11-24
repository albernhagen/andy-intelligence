# 2026-11-23 — AI-356: Andy's decisions: ADR-0096 and ADR-0124 accepted, up-to-date branches not required

From the 2026-11-23 product and architecture review.

- **ADR-0096: Managed repos call one executor:** accepted, on condition that agent tasks in different projects run in parallel. Verified: the executor's concurrency group is per agent task (`agent-run-<run_id>`), and dispatch caps are 4 across projects and `runsAtOnce` per project. Its pending-decision line is removed.
- **ADR-0124: Merge modes:** accepted.
- **Up-to-date branches:** GitHub shall not require them (ADR-0144). AI-284: Require a PR to be up to date with main is cancelled; the merge queue (AI-110: M5.18: Merge queue per repo) syncs a PR before each merge and replaces it. The gate's clean rule (head contains the latest `main`) stays.
