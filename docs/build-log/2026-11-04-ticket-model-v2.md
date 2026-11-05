# 2026-11-04 — Ticket model v2 (AI-24)

Built ADR-0058: Ticket model in one PR, contracts first.

- **Types** `feature`, `chore`, `bug`, `epic`; type may be empty (`null`) at capture, so a title alone is a ticket (UI, REST, MCP `create_ticket`). Type is editable now.
- **`needsYou` → `needsAttention`** on the ticket and the list filter (`?needsAttention=true`). The inbox, `GET /api/needs-you`, `TicketService.needsYou()`, the `status` overview count and MCP `list_needs_me` keep their names: they answer for the viewer.
- **Readiness per type** (`checkDor`): feature needs intent and criteria that each contain "… shall …" (any subject); bug needs a body (repro and actual behaviour) and a criterion; chore needs intent and a checklist item in any wording; all three need size and its reason; a ticket without a type lists "type". Epic unchanged. Tier is not checked.
- **Tier derived from size**: `tierFor` and `TIER_FOR_SIZE` in `packages/domain/src/tiers.ts` (S → `fast` = Sonnet, M/L → `strong` = Opus, ADR-0050); `overrides.tier` pins one. The stored `tier` field is gone; refine runs still use the `fast` route until M1.8: Build + gate.
- **Scope lists** `outOfScope` and `touches` (≤ 20 items, ≤ 300 chars each, ADR-0028).
- **Refine** proposes type, size, out of scope and touches; each is written only where the ticket's field is empty (`refineFills`). No tier.
- **Upgrader**: `SCHEMA_VERSION` 1 → 2; `ticketV1toV2` runs on read (`story` → `feature`, `task` → `chore`, `needsYou` → `needsAttention`, stored `tier` dropped); the next write stores v2. The Firestore `needsAttention` filter runs in memory, since un-rewritten v1 documents still store `needsYou`.
- **Found on the way**: Zod 4 applies defaults inside `.partial()`, so every ticket edit sent `archived: false` and unarchived the ticket. `TicketFields` now redeclares `archived`, `outOfScope` and `touches` without defaults; a contract test covers it.
- Stored tiers are dropped on upgrade (ADR-0062: The ticket's stored tier is dropped, lands with the ARCHITECTURE edits); a ticket that needs a specific tier gets `overrides.tier`. The deploy pauses auto-refine so no refine run spans the schema switch (runbook). Andy runs a manual export before the deploy (`docs/runbooks/ticket-core.md`).
