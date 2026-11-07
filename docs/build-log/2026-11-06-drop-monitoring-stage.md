# 2026-11-06 — Monitoring stage dropped until M6: Dev → prod releases

AI-36: Drop the Monitoring stage until M6: Dev → prod releases; a merge completes a ticket to Done. ADR-0069: No Monitoring stage until M6.

- **Why:** Andy, 2026-11-06: Monitoring belongs to M6: Dev → prod releases and isn't the right word. Nothing deploys or verifies before M6, so every merge walked tickets through it in one webhook.
- **Stages now:** Backlog → Ready → In progress → Ready for review → Done, plus Cancelled. A merge from Ready for review records one move to Done; from earlier stages it still walks every step (ADR-0067).
- **Data:** `SCHEMA_VERSION` 3. Tickets stored in `monitoring` and `stage_changed` events naming it read as Done (`ticketV2toV3`, `ticketEventV2toV3` in `packages/store`). A Done filter queries `stage in [done, monitoring]` so a stored `monitoring` ticket shows up under Done before its next write.
- **Input:** `monitoring` is rejected by the REST API, the ticket filter and MCP `move_ticket`.
- **UI:** the board's Monitoring strip is gone; Done is the only strip. Screenshots regenerated.
- **Next:** M6 adds its own verification stage, named then.
