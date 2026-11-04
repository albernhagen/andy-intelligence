# 2026-11-02 — M1.1: MCP OAuth spike merged and demoed

- Merged: PR #29: MCP OAuth spike and PR #28: UI: tickets + inbox. Both review agents passed with no blocker or high/critical finding; the 5 lower findings were fixed before merge (threat-model table, lookup caps, failed-lookup cache, refresh tests, consent text; R14 added).
- Applied by Andy: `infra/control-plane` (`PUBLIC_URL` env, `oauthGrants` TTL). `pnpm test:firestore` passed (19 tests, incl. the 5 `OAuthGrantStore` contract tests) once Java was installed.
- **Demo passed:** Claude custom connector added with `https://control-plane-662512537397.us-central1.run.app/mcp`; Google sign-in + Approve on the consent page; `ping` from a Claude session returned `pong (signed in as <Andy's email>)`. Claude used CIMD (the server offers no other registration), so DCR isn't needed.
- Allow-list rejection: **Decided (Andy):** no second Google account; the automated tests are the proof (non-allow-listed account → 403 at approve, removed email → 401 on `/mcp` and `invalid_grant` on refresh). Live probes without credentials all refused: approve with no or a forged token → 401, `/mcp` with a random token → 401, a made-up code → `invalid_grant`, a non-Claude `client_id` → `invalid_client`.
- M1.1: MCP OAuth spike Done when met. M1.4: MCP core tools is unblocked on the auth side (still needs M1.2: Ticket core, merged).
- Lesson: the emulator needs a Java runtime; the runbooks now say how to install one.
