# 2026-11-21 — AI-288: Parity: spend per provider in get_spend

Step 3 of AI-285: Web UI and MCP parity. The Spend panel showed spend by provider (`GET /api/projects/{id}/spend/providers`); MCP `get_spend` returned caps and totals only.

- **`get_spend`** now also returns `byProvider`: the project's and all projects' spend per provider, today and this month, exactly as the route returns it (null when the spend ledger can't be read, never zero).
- **One implementation:** new `SpendSettingsService.byProvider()` (`apps/api/src/spend.ts`) reads AI-280's `totalsByProvider` for the project and globally (two bounded reads, ADR-0126). The route and the tool both call it; the route's own copy of the read is gone.
- **Parity test** (`spend.test.ts`): the same figures over MCP and REST with spend on two providers and with no ledger; the same not-found refusal for an unknown project.
- **Inventory** (`docs/architecture/ui-mcp-parity.md`): "Spend per provider" moves to Matched and the AI-288 gap row goes.
