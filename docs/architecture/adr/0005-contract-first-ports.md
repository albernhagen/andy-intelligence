---
status: accepted
date: 2026-10-21
---

# 0005 — Contract-first ports and adapters

## Decision Outcome

- Domain entities and port interfaces live in `packages/contracts` as Zod schemas + TS types. No vendor terms (Jules "session", GitHub "node ID", Claude "rate_limits") appear there; adapters translate.
- Every port with a contract suite (ADR-0012) ships an in-memory fake that passes the suite; real adapters import the suite from `@andy/contracts/testing` and run it against a sandbox.
- The API publishes OpenAPI 3.1 at `/openapi.json`, generated from the same Zod schemas (`@hono/zod-openapi`). The UI client and MCP tools are generated from it (M1).

### Consequences

- Good: vendors swap without touching the domain; tests run without network.
- Bad: mapping code in every adapter.
