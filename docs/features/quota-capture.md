# Quota capture

Tasks report 5-hour and weekly usage; header gauge per window, "unknown" if stale or missing; persistent banner at warn (70%), pause (80%), unknown. A fresh pause reading stops dispatch; warn allows one task (ADR-0079, ADR-0100); unknown doesn't. **Clear quota idle** discards a doubted reading (AI-74). Claude reads the same status over MCP with `get_quota` (AI-286). On a phone (AI-176) the header shows the fullest window ("Quota 72%") and a **Pause**/**Resume** button for the project in scope: one tap pauses or resumes dispatch.

**How to use:** the header gauge, or MCP `get_quota` and `clear_quota_idle`. Rules: `docs/runbooks/quota.md`
