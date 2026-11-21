# 2026-11-21 — AI-289: Parity: send a test email over MCP

Step 3 of AI-285: Web UI and MCP parity. The settings page could send a test email; MCP couldn't.

- **`test_email`** (`apps/api/src/mcp/tools-notify.ts`): no input; sends the same test email as `POST /api/notify/email/test`, or refuses with the route's reason: "email is not configured", "today's 20 emails are used", or the provider's refusal.
- **One implementation:** new `sendTestEmail` (`apps/api/src/notify.ts`) holds the rule; the route maps it to 200, 409 or 502 and the tool to a result or a tool error with the same text. The cap is `EmailNotifications.sendTest`'s, so both share the 20-a-day count; a provider refusal gives the slot back.
- **Access:** names no project; listed in `CROSS_PROJECT_TOOLS` as owner only, like the route in `CROSS_PROJECT_ROUTES`.
- **Parity test** (`tools-notify.test.ts`): not configured, sent, cap reached and provider refusal, each the same over REST and MCP. `flow.test.ts`'s tool list gains `test_email`.
- **Left web-only:** `GET /api/notify/email`'s count sent today and the cap. MCP reports only whether email is configured (`set_email_notifications`, `test_email`); the inventory row says so.
