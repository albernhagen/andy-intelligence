# 2026-11-21 — AI-300: Parity: registry test that every action has a route and a tool

Step 2 of AI-285: Web UI and MCP parity. The inventory (`docs/architecture/ui-mcp-parity.md`) is now enforced.

- **Registry** (`apps/api/src/parity.ts`): one entry per user action naming its signed-in `/api` routes (as Hono registers them) and its MCP tools. Today: 84 routes and 75 tools in 34 actions.
- **One side, with the reason:** register a runner (its secret is shown once), OAuth consent (the browser half of MCP sign-in), GitHub App setup (GitHub's manifest flow needs a browser). Field-level exceptions are notes: Builds is web only (ADR-0063); the email status's count and cap are web only.
- **Open gaps, each with its ticket:** AI-294 (list and revoke runners, held for Andy's decision on ADR-0089), AI-296 (the board over MCP, waits on PR #320), AI-299 (ideate from the web UI: the route exists but the web never calls it; PR #240).
- **Test** (`apps/api/src/parity.test.ts`, the app with every feature on): fails when a route or tool is in no action (and names it), when an entry names a route or tool that doesn't exist, when an entry has one side without a reason, or when the list of open gaps changes without the registry. Checked by removing `GET /api/me` from its entry: the test failed and named it.
