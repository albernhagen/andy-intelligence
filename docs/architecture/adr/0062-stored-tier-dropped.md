---
status: accepted
date: 2026-11-05
amends: ARCHITECTURE §4.2, §5, §10.4
---

# 0062 — The ticket's stored tier is dropped; tier is computed from size

Built by AI-24: Ticket model v2 (PR #71, merged by Andy), which builds ADR-0058: Ticket model. Asked for by that PR's adversarial review.

## Context and Problem Statement

ADR-0058 says the tier is "derived from size by policy; no longer a DoR item. `overrides.tier` still pins one". It does not say what happens to the stored `Ticket.tier` field. Keeping it gives two ways to pin a tier (`tier` and `overrides.tier`) and a field nothing writes any more: refine no longer proposes one.

## Decision Outcome

| Topic         | Decision                                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field         | `Ticket.tier` is removed from the schema, `NewTicket` and `TicketFields`. `tierFor(ticket)` (`packages/domain/src/tiers.ts`) is the only way to get the tier: `overrides.tier`, else from size (S → `fast`, M and L → `strong`, ADR-0050). Without either it is null. |
| Stored values | The v1 → v2 upgrader (`ticketV1toV2`, §10.4) drops the stored `tier` on read, and the next write removes it. The value is not moved into `overrides.tier`: almost all of them were refine's guesses, and pinning them would stop size from deciding.                  |
| Trace         | The upgrade is lossy on purpose. The manual export taken before the deploy (`docs/runbooks/ticket-core.md`) keeps the old values. A ticket that needs a specific tier gets `overrides.tier`, from the Tier select on the ticket form.                                 |
| UI            | The Tier select edits `overrides.tier`. Its empty option shows the tier from size.                                                                                                                                                                                    |

### Consequences

- Good: one way to pin a tier; nothing stored that can disagree with the size.
- Bad: a tier Andy set by hand before the deploy is lost unless he re-pins it. The export is the only copy.
