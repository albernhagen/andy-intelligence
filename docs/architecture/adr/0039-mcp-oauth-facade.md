---
status: accepted
date: 2026-11-02
amends: 0010
---

# 0039 — MCP OAuth facade: our own authorization server, Firebase Google sign-in, CIMD clients

Decided by Andy, 2026-11-02 (M1.1: MCP OAuth spike). Answers ARCHITECTURE open question 9.

## Context and Problem Statement

Claude desktop's custom connector must reach `/mcp` on the control plane, and only Andy (the email allow-list, ADR-0010) may use it. ADR-0010 left MCP auth open.

Verified (Claude connector docs, 2026-11-02):

| Topic        | What Claude does                                                                                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery    | Needs a `401` with `WWW-Authenticate: Bearer resource_metadata="…"` (RFC 9728: protected resource metadata). The metadata's `resource` must equal the URL entered in Claude. Uses only the first `authorization_servers` entry, then its RFC 8414 or OpenID metadata.                                       |
| Registration | DCR (dynamic client registration, RFC 7591: an open `/register` endpoint) or CIMD (client ID metadata document: the `client_id` is an HTTPS URL on `claude.ai` whose JSON lists the redirect URIs). CIMD is used when the server advertises `client_id_metadata_document_supported` and auth method `none`. |
| Flow         | Authorization code with PKCE S256 (proof key: ties the code to the app that asked for it); rotates refresh tokens; refreshes on `401` and before expiry.                                                                                                                                                    |
| Callback     | `https://claude.ai/api/mcp/auth_callback` (maybe `claude.com` later); Claude Code uses loopback `http://localhost:<port>/…`.                                                                                                                                                                                |

## Options

| Option                                                      | Verdict                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Google as the authorization server, static client        | Rejected. Google has neither DCR nor CIMD, so Andy pastes a client ID and secret into Claude; needs a hand-made OAuth client; Google access tokens are opaque (a `tokeninfo` call per request); no refresh token unless `access_type=offline`, which Claude doesn't send (re-sign-in hourly). |
| B. Our own authorization server, DCR                        | Fallback only. An open write endpoint on the internet: needs caps and cleanup for registered clients.                                                                                                                                                                                         |
| **C. Our own authorization server, CIMD, Firebase sign-in** | **Chosen.** No client storage, no open write endpoint, no new OAuth client or secret; reuses the existing Google sign-in and allow-list check.                                                                                                                                                |

## Decision Outcome

| Question             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization server | The API itself (`apps/api/src/mcp/`): issuer = `PUBLIC_URL` (the service's `run.app` URL, set by Terraform); resource = `PUBLIC_URL/mcp`. MCP routes are absent when `PUBLIC_URL` is unset.                                                                                                                                                                                                                                                               |
| Clients              | CIMD only, `client_id` host must be `claude.ai` or `claude.com` (no SSRF to other hosts); 5 s timeout, 16 KB cap, no redirects, 1 h cache of ≤ 20 entries. Redirect URI must match exactly (loopback: any port). No DCR.                                                                                                                                                                                                                                  |
| Sign-in              | `/oauth/authorize` validates and redirects to the SPA page `/oauth/consent`. Andy signs in with Firebase Google sign-in and approves; the SPA posts to `/api/oauth/approve` behind the existing `/api` middleware (ID token + allow-list). Nothing is stored before approval.                                                                                                                                                                             |
| Tokens               | Opaque random 256-bit tokens, stored only as SHA-256 hashes in Firestore `oauthGrants` (port `OAuthGrantStore`). Code 60 s, single use; access token 1 h; refresh token 30 days, rotated on every use. Firestore TTL deletes expired grants. No signing key, so no secret.                                                                                                                                                                                |
| `/mcp`               | Official MCP TypeScript SDK, Streamable HTTP, stateless (new server per request). Every request re-checks the email against `ALLOWED_EMAILS`, so removing it revokes all tokens. Scope `mcp` only.                                                                                                                                                                                                                                                        |
| Caps (ADR-0028)      | Per instance (max 2): 120 grant-store lookups/minute from `/mcp` and `/oauth/token` (then `429`); tokens that aren't 43 base64url characters are rejected without a lookup; 30 metadata fetches/minute, failures cached 1 minute. Worst case ≈ 240 Firestore reads/minute ≈ 350k/day; after the free 50k/day that is at most ≈ $0.20/day; usage alerts and the kill switch back it. Trade-off: a flood can make MCP answer `429` for Andy until it stops. |
| Errors               | `/oauth/authorize` errors are shown as `400`, never redirected. Token errors follow RFC 6749 (`invalid_grant` etc.).                                                                                                                                                                                                                                                                                                                                      |
| Proof                | Automated: the MCP SDK's own OAuth client runs discovery → CIMD → consent → token → `ping` → refresh against the app (`flow.test.ts`). Live: Andy adds the connector after deploy (runbook `docs/runbooks/mcp-connector.md`). If Claude desktop doesn't use CIMD, add DCR limited to Claude's callback URLs in a new ADR.                                                                                                                                 |

### Consequences

- Good: no OAuth client, no secret, no signing key; one allow-list check for UI and MCP; tokens revocable by deleting documents or editing the allow-list; works for Claude Code (loopback) too.
- Bad: we own security-critical OAuth code (~300 lines; covered by tests and the security review). One Firestore read per MCP request. Refresh-token reuse isn't detected beyond single use (no family revocation). Only Claude's hosts can be clients; another MCP client needs a code change.
- M1.4: MCP core tools adds tools to `registerMcpEndpoint` and uses the same auth unchanged.
