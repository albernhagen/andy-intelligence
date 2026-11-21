# 2026-11-21 — AI-298: Parity: ranked Ready list in the web UI

- One read for both sides: `readyList` in `packages/domain/src/ready-list.ts` (Ready, unarchived, filtered by size, risk or confidence, board rank order, at most 100, each with its score label and reasons). MCP `list_ready` now calls it; new REST `GET /api/projects/<id>/ready` takes the same filters. Both refuse an unknown project (`not_found`) and a filter value outside the fixed lists. `ready.test.ts` checks that REST and MCP return the same thing.
- Web: the Ready view at `/p/<project>/ready`, linked as "Ranked list" from the board's Ready lane. Filters live in the URL. One project only, like `list_ready`. The board's "Sort by score" toggle is unchanged.
- The ticket panel's question form follows `design.md`'s per-row submit rule (AI-316): "Answer" is outlined and the field is named.
- Inventory: `docs/architecture/ui-mcp-parity.md` lists it as matched.
