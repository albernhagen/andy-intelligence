# 2026-11-21 — AI-321: Milestone create and edit over MCP

Split out of AI-304: M4.34: Milestone API and MCP tools, because going past ADR-0131's three MCP milestone tools needs its own ADR.

- **ADR-0136 (proposed):** extends ADR-0131 to five MCP milestone tools. Reasons: the web UI and MCP are both first-class, and AI-307 creates project AI's milestones over MCP. ADR-0131's body is unchanged; its status line notes the amendment. Andy merges this PR: it carries a decision.
- **MCP** (`apps/api/src/mcp/tools-milestones.ts`): `create_milestone` (name, outcome, optional order) and `edit_milestone` (any of name, outcome, order), owner-only, over the same `MilestoneService` as the routes: the 50-per-project cap and a logged, revertable change on every write. No delete tool (no delete route).
- **Parity:** `POST` and `PATCH …/milestones` now match the tools; the AI-321 pending mark is gone.
- **Tests:** 4 API tests over REST and MCP: create on each, bad input refused on each, edit on each then reverted from the change log, an unknown milestone refused with the same text. An empty edit (adversarial review) changes and logs nothing on either side.
