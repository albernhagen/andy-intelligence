---
title: "Refresh-token grace window: a used MCP refresh token works 60 s more"
status: accepted
date: 2026-11-20
amends: 0039 (refresh-token rotation)
---

# 0105 — Refresh-token grace window: a used MCP refresh token works for 60 more seconds

Decided by Andy, 2026-11-20 (AI-152: MCP refresh-token grace window).

## Context and Problem Statement

Andy has to reconnect the `andy-intelligence` MCP connector too often. ADR-0039: MCP OAuth facade made refresh tokens strictly single-use: the first refresh deletes the token.

- Every Claude Code session on one machine shares one stored refresh token. A coordinator and its workers run at once; when the 1-hour access token expires, two can refresh with the same token. The second gets `invalid_grant` and Claude asks for a new sign-in.
- A refresh whose response is lost (cold start, timeout) has the same effect: the old token is gone and the new one never arrived.

This cause is read from the code. It was not confirmed in Cloud Logging before the change; the new log line below confirms it after deploy.

## Options

| Option                                       | Verdict                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A. Keep single use                           | Rejected. The reconnects stay.                                                                                                       |
| B. Stop rotating (one 30-day token)          | Rejected. OAuth 2.1 asks public clients (no client secret) to rotate refresh tokens; a stolen token would work for its full 30 days. |
| C. Longer access tokens                      | Rejected. Fewer refreshes, same race; a stolen access token works longer.                                                            |
| **D. Rotate, with a 60-second grace window** | **Chosen.** The standard fix for clients that share a token (other providers call it a reuse interval or leeway).                    |

## Decision Outcome

| Question      | Decision                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On refresh    | Still returns a new access and refresh token. The used refresh token is not deleted: its expiry is cut to now + 60 s (`REFRESH_GRACE_S`, `apps/api/src/mcp/oauth.ts`).                          |
| Reuse         | Inside the window, each use returns its own new pair and leaves the expiry alone, so reuse can't extend the window. After it: `invalid_grant`, as before.                                       |
| Unchanged     | Authorization codes stay single-use (`take`). Client ID check, allow-list re-check on every use, 30-day refresh lifetime, 1-hour access tokens, the lookup cap (ADR-0028: GCP cost guardrails). |
| Store         | No port or schema change: `OAuthGrantStore.get` + `put`. The read and the write aren't one atomic step; two racing refreshes both set the same 60-second expiry, which is the intended result.  |
| Observability | A reuse logs `oauth refresh: token reused inside the grace window` (`component="mcp-oauth"`). Many of these with no parallel sessions running is a sign of a stolen token.                      |

### Consequences

- Good: parallel sessions and lost responses no longer force a new sign-in. One file of server code.
- Bad: a stolen refresh token replayed within 60 s of Andy's own use is accepted (before: rejected). The added risk is small: a stolen token used _before_ Andy's already worked, and still does (threat-model R12). Each use inside the window starts its own token chain; unused chains expire after 30 days.
- Still no token-family revocation (ADR-0039's open downside).
- Not covered: the lookup cap (120 a minute per instance) also counts valid requests. If Cloud Run logs show `429` on `/mcp` or `/oauth/token`, that is a separate fix.
