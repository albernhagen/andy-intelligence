# 2026-11-21 — AI-293: Parity: a ticket's full history and runs over MCP

- New read-only MCP tools in `apps/api/src/mcp/tools-history.ts`: `ticket_history` (a ticket's whole history, oldest first), `list_runs` (its agent tasks, newest first) and `get_run` (one task). Each calls the service its route calls: `TicketService.history`, `RunService.list` and the new `RunService.get`, which the run route now uses too (another project's task answers as not found on both).
- The routes return whole lists (the web needs them whole); MCP answers come in pages (`pageOf` in `packages/domain/src/paging.ts`: 50 by default, at most 200, ADR-0028) with `total` and `nextOffset`. `history.test.ts` checks that the pages, read in order, are exactly the route's list, and that both sides refuse an unknown ticket, another project's task and a malformed task id.
- Reads stay per ticket (ADR-0126): no tool reads the whole project.
- Inventory: both rows matched, and the parked "which layer set worker, tier, route" row moved to matched (AI-282 shipped it in both).
