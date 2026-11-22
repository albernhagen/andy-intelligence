# Daily digest

A model-written summary of yesterday on top (days end at midnight Mountain time; AI-323, ADR-0137): what Andy can now do, one line per milestone or epic, each with its tickets and PRs. The first read after midnight starts its one agent task; a failure says why and offers one retry. Then exceptions (failed tasks, PRs closed unmerged, rework, reverts, review blockers, tickets waiting on Andy or blocked, dispatch idle, quota at reserve), then merges (who, gate verdict, cost), in progress, totals (ADR-0081)

**How to use:** What's new in a project shows its exceptions first, with a 24 hours window (`/p/AI/digest` opens it; AI-341); MCP `digest` with `project`, optional `hours`, `until`; `GET /api/projects/ai/digest`; retry a failed summary: What's new → **Retry once**, MCP `retry_digest_summary`
