# Daily digest

A model-written summary of yesterday on top (days end at midnight Mountain time; AI-323, ADR-0137): what Andy can now do, one line per milestone or epic, each with its tickets and PRs. Andy's first read after midnight starts its one agent task; a failure says why and offers one retry. Then exceptions (failed tasks, PRs closed unmerged, rework, reverts, review blockers, tickets waiting on Andy or blocked, dispatch idle, quota at reserve), merges (who, gate verdict, cost), in progress, totals (ADR-0081)

**How to use:** Header → Digest in a project (`/p/AI/digest`); MCP `digest` with `project`, optional `hours`, `until`; `GET /api/projects/ai/digest`; retry a failed summary: the page's **Retry once**, MCP `retry_digest_summary`
