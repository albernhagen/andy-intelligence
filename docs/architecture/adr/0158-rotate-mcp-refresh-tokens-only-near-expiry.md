---
title: "Rotate MCP refresh tokens only near expiry: each token works to its own 30-day limit"
status: accepted (Andy, 2026-11-26; AI-391)
date: 2026-11-26
supersedes: 0105 (refresh-token grace window)
amends: 0039 (refresh-token rotation)
---

# 0158 — Rotate MCP refresh tokens only near expiry: each token works to its own 30-day limit

Chosen by Andy, 2026-11-26 (AI-391: MCP sign-in survives many sessions refreshing at once).

## Context and Problem Statement

On 2026-11-26, with eight or more Claude desktop sessions running, every session lost the `andy-intelligence` MCP connector and Andy had to reconnect by hand.

- All local Claude Code sessions share one stored sign-in. ADR-0105: Refresh-token grace window rotated the refresh token on every refresh and cut the used one to 60 s. A session that still held the old token and refreshed later got `invalid_grant` and needed a new sign-in.
- Whether Claude Code re-reads the stored token before refreshing, or clears it for every session after one refusal, is unknown. A fix must not depend on it.
- The local MCP registration and the claude.ai connector each sign in on their own (separate client IDs, separate grants). Nothing on the server revokes one because of the other.
- The cause is read from the code; Cloud Logging was not checked before the change. A second candidate, the lookup cap (120 a minute per instance, ADR-0028: GCP cost guardrails) counting valid `/mcp` calls, is not changed here; its `429`s now log a line.

## Options

"Theft detection" means: how soon a copied refresh token stops working. Under ADR-0105 a copied token died 60 s after Andy's next refresh; no rule revoked the rest of a stolen sign-in.

| Option                                 | Verdict                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A. Grace window of 1 hour              | Rejected. A copied used token works 1 h. A session idle for more than 1 h on an old token still drops.                |
| **B. Rotate only near expiry**         | **Chosen.** Every token a session holds works to its own limit, whatever the timing or client behaviour.              |
| C. Token family with reuse revocation  | Rejected. The only real theft detection, but a stale session's reuse would revoke every session: the drop this fixes. |
| D. No rotation, shorter limit (7 days) | Rejected. Same theft profile as B, and Andy reconnects every week.                                                    |

## Decision Outcome

| Question      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifetimes     | Access token 1 h. Refresh token 30 days from issue (`REFRESH_TTL_S`), fixed: using it never extends or shortens it. Past it: `invalid_grant`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| On refresh    | A new access token every time. The same refresh token comes back while it has more than 7 days left (`ROTATE_WITHIN_S`); with 7 days or fewer, a new 30-day refresh token. The presented grant is never written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Concurrency   | No write to the presented grant, so any number of sessions refreshing at once each get a working pair. No read-then-write race.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Unchanged     | Authorization codes single-use. Client ID check and allow-list re-check on every refresh. Revoke by deleting `oauthGrants` (runbook `mcp-connector.md` §5). No port, schema, Terraform or IAM change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Observability | Every refused refresh logs `oauth refresh refused` (`component="mcp-oauth"`) with `reason` (`malformed`, `unknown_or_expired`, `not_a_refresh_token`, `client_mismatch`, `user_not_allowed`), `clientId`, `uid` and `tokenAgeS` (null when the store has no live grant). Never a token value or hash. Each issue logs `rotated` and `tokenAgeS`. `tokenAgeS` is derived from the fixed 30-day expiry, so it is wrong only for grants ADR-0105 had already cut to 60 s, which expire within a minute of deploy. The first `429` per minute per instance on `/oauth/token` or `/mcp` logs `oauth request rate limited` / `mcp request rate limited`; the Cloud Run request log counts the rest. |

### Consequences

- Good: many sessions sharing one sign-in no longer force a new sign-in; a lost refresh response is harmless. One file of server code.
- Bad: a copied refresh token works until its own 30-day limit (before: until 60 s after Andy's next refresh). Before, a thief who refreshed first already kept a 30-day chain, so the loss is a thief who copies and waits. Risk R12 records it.
- Bad: OAuth 2.1 asks public clients to rotate refresh tokens or bind them to the sender; here rotation happens only in the last 7 days.
- Each refresh in the last 7 days mints a new token; old ones expire on their own limit (Firestore TTL deletes them).
- Still no token-family revocation (ADR-0039's open downside).
