# 2026-11-26 — AI-391: MCP sign-in survives many sessions refreshing at once

- Trigger: with eight or more desktop sessions running, every session lost the `andy-intelligence` connector; Andy reconnected by hand.
- Cause read from the code, not yet confirmed in Cloud Logging: rotation on every refresh with a 60 s grace window (ADR-0105) refused any session still holding an older token. The local MCP registration and the claude.ai connector have separate grants and don't collide. Second candidate left open: the lookup cap (120 a minute per instance) counts valid `/mcp` calls too; its `429`s now log a line.
- Fix (ADR-0158: Rotate MCP refresh tokens only near expiry, Andy's option B): a refresh returns the same refresh token until 7 days are left, and old tokens work to their own fixed 30-day limit. Every refused refresh logs its reason and token age.
- Follow-up if logs show `429` bursts: cache valid access tokens per instance so only unknown tokens spend the lookup cap.
