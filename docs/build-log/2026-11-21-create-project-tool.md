# 2026-11-21 — AI-297: Parity: create a project over MCP

Step 3 of AI-285: Web UI and MCP parity. The Projects page created projects (`POST /api/projects`); MCP could only list them.

- **`create_project`** (`apps/api/src/mcp/tools-projects.ts`): key, name and optional repos; returns the project, as the route does.
- **One implementation:** both call `ProjectService.register`, so the validation and refusals are the same: key format, key taken, repo invalid, taken by another project, or without our GitHub App.
- **Owner only, on both sides:** `register` now requires the new owner action `register_project` (`permissions.ts`). The route passes its caller; today every allow-listed user is the owner, so the route behaves as before. MCP callers act as themselves (`user:<uid>`); a non-owner gets `forbidden` (domain test).
- **Starts nothing:** `register` only validates repos (reads through the code host) and stores the project; no GitHub App flow, brief, plan or agent task starts, on either side.
- **Parity test** (`tools-create-project.test.ts`): the same project shape over REST and MCP, no agent task started, and the same refusals for a taken key, an invalid repo and an invalid key. `flow.test.ts`'s tool list gains `create_project`.
