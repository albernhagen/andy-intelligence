# 2026-11-21 — AI-294: Parity: list and revoke runners over MCP (list only)

Step 3 of AI-285: Web UI and MCP parity. The Runners page lists, registers and revokes local runners; MCP had none.

- **`list_runners`** (new `apps/api/src/mcp/tools-runners.ts`, one line in `tool-groups.ts`): read-only, no input; returns what `GET /api/runners` returns (name, projects, agent tasks at once, who registered it and when, expiry, last seen, present, state), never a secret. Same `RunnerService.list` call as the route; active runners are capped at 2, so the read stays small.
- **Register stays web-only:** it shows the runner secret once, and a secret must not land in a chat transcript.
- **Revoke waits for Andy:** ADR-0089 keeps minting and revoking where a person signs in, so adding `revoke_runner` would amend that accepted ADR. It stays a tracked gap in the inventory until he decides.
- **ADR-0089 also says MCP can't list runners** (credential table). The adversarial review raised that as a blocker; this PR waits for Andy's decision too.
- **Parity test** (`tools-runners.test.ts`): the same runners over MCP and REST (one active, one revoked), no secret in the MCP text, and no register tool, with its reason recorded (`RUNNER_ACTIONS_WEB_ONLY`) for AI-300's registry test.
- **Docs:** the inventory (list matched; revoke a tracked gap), `api-and-mcp.md` and the `runners.ts` comment no longer say "no runner tools", one line in `docs/security/ui-and-mcp.md`, `docs/features/local-executor.md`.
