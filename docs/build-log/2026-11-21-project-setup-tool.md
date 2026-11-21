# 2026-11-21 — AI-287: Parity: project setup checklist over MCP

Step 3 of AI-285: Web UI and MCP parity. The settings page showed a project's setup checklist; no MCP tool read it.

- **`project_setup`** (`apps/api/src/mcp/tools-projects.ts`): read-only, takes a project key; returns what `GET /api/projects/{id}/setup` returns: the five steps, each done, missing, unknown or not yet, with what is left.
- **One implementation:** new `SetupChecklistReader` (`apps/api/src/setup.ts`, a `setup` field in the shared services and `ToolDeps`). The route and the tool both call it; the route's inline copy is gone. Bounded as before: the project's first repo once plus one file per baseline file and the threat model (ADR-0028, ADR-0126).
- **Access:** the tool names its project, so the project-access check covers it; an unknown or unreadable project is "not found" on both sides.
- **Parity test** (`tools-setup.test.ts`): the same checklist over MCP and REST for a project with and without a repo; the same not-found refusals. `flow.test.ts`'s tool list gains `project_setup`.
- **Inventory** (`docs/architecture/ui-mcp-parity.md`): setup moves from gaps to matched. Quota (AI-286) moves in PR #314, which adds `get_quota`.
