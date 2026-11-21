# 2026-11-20 — AI-152: MCP refresh-token grace window

Andy had to reconnect the `andy-intelligence` MCP connector too often.

- Cause, read from the code: refresh tokens were single-use with no grace (ADR-0039: MCP OAuth facade). Parallel Claude Code sessions share one stored refresh token; when two refreshed at once, or a refresh response was lost, the loser got `invalid_grant` and Claude asked for a new sign-in.
- Not confirmed in Cloud Logging before the change (the session had no log access). After deploy, the new log line `oauth refresh: token reused inside the grace window` (`component="mcp-oauth"`) shows each time the window saved a session.
- Fix (ADR-0105: Refresh-token grace window): a used refresh token expires 60 s later instead of at once (`REFRESH_GRACE_S`, `apps/api/src/mcp/oauth.ts`). Reuse inside the window returns a new pair and can't extend the window. Authorization codes stay single-use. No port, schema, Terraform or IAM change.
- Risk: threat-model R12 now says a replayed refresh token is accepted for 60 s after use.
- Open: the lookup cap (120 a minute per instance) also counts valid requests. If the Cloud Run request log shows `429` on `/mcp` or `/oauth/token`, parallel sessions are hitting it; that needs its own ticket. Queries: runbook `mcp-connector.md`, Troubleshooting.
