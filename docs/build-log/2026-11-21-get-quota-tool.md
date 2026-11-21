# 2026-11-21 — AI-286: Parity: quota readings over MCP

Step 3 of AI-285: Web UI and MCP parity. MCP could clear a quota idle but not read quota.

- **`get_quota`** (`apps/api/src/mcp/tools-quota.ts`): read-only, no input; returns what `GET /api/quota` returns: the latest reading per window, freshness, level and thresholds.
- **One implementation:** the route and the tool both call `QuotaClearer.status()` (`packages/domain/src/quota.ts`), which reads the store's latest readings (one per window) and runs `quotaStatus`. The route's own copy of that read is gone.
- **Access:** subscription quota names no project, so `get_quota` is listed in `CROSS_PROJECT_TOOLS` beside `clear_quota_idle`, like the route in `CROSS_PROJECT_ROUTES`.
- **Parity test** (`tools-quota.test.ts`): the same status over MCP and REST with readings and with no store, the tool is read-only with no input, and the route refuses a caller off the allow-list.
