# Dashboards

Four headline numbers for the window (lead time in the latest week with a Done ticket, CI green on first try, rework and review blockers, cost; AI-378), then per UTC week: tickets by stage, lead time, rework, CI green on first try, review blockers; cost, tokens and quota by step or size; costliest agent tasks; All projects adds each project; capped figures say partial; an empty figure says "Nothing to chart yet" instead of drawing axes. A project's DORA metrics (deploy frequency, lead time, change failure rate, time to restore) over 30 or 90 days, from production deployment records: a rollback marks the deployment it replaced as failed and restored (AI-200)

**How to use:** Header → Dashboards (`/p/AI/dashboards`, `/all/dashboards`); `GET /api/dashboard`, `GET /api/projects/ai/dora`; MCP `dashboard` (optional project: then the project's figures and its DORA metrics; AI-295)
