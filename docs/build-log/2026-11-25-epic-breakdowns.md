# 2026-11-25: Epic breakdowns (AI-383), PR 1 of 2

- Andy approved the plan: reuse the project-plan lifecycle, a new `plan-epic` step, tickets in Ideas, two PRs (service, agent task and MCP first; web panel and inbox second).
- One change from the plan: the breakdown lives in its own store (`EpicBreakdownStore`), not as a field on the epic ticket. Every ticket write logs a full before-and-after diff, so a 12-ticket proposal on the ticket would be copied into the epic's history at each status change (ADR-0155).
- `plan-epic` isn't on the local runner's step list: like plan-project, it runs on the cloud executor only.
