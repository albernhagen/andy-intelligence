# 2026-11-21 — AI-295: Parity: dashboards and DORA metrics over MCP

- New read-only MCP tool `dashboard` (`apps/api/src/mcp/tools-dashboard.ts`). Without a project it returns what `GET /api/dashboard` returns; with one, `{ dashboard, dora }`: the project dashboard and DORA routes together. Optional `weeks` takes the routes' range.
- One `DashboardReader` and one `DoraReader` now live in the app's services, and the three routes and the tool use them, with the app's clock (`now`), so both sides compute the same windows. The tool reads nothing the routes don't.
- `dashboard` may run without a project (listed in `CROSS_PROJECT_TOOLS`, like `status`); a named project goes through the project-access check.
- `dashboard-mcp.test.ts` checks equality with the routes, with and without a project, and the shared refusals (unknown project, too many weeks).
