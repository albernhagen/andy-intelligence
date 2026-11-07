---
status: accepted
date: 2026-11-06
amends: 0056, 0067, ARCHITECTURE §4.1
---

# 0069 — No Monitoring stage until M6: a merge completes a ticket to Done

Built in AI-36: Drop the Monitoring stage until M6: Dev → prod releases. Amends ADR-0056: A merged PR completes its ticket, and ADR-0067: PR events move a ticket from any open stage.

## Context and Problem Statement

Monitoring was the stage between Ready for review and Done where dev deploys get verified. Nothing deploys or verifies before M6: Dev → prod releases, so a merge walked every ticket through Monitoring to Done inside one webhook (ADR-0056, ADR-0067). The board showed a lane that was always empty. Andy, 2026-11-06: drop it until M6; "Monitoring" isn't the right word anyway.

## Decision Outcome

| Topic       | Decision                                                                                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stages      | Backlog → Ready → In progress → Ready for review → Done, plus Cancelled. Ready for review → Done is the one-step forward move; rework is Ready for review → In progress.                                                                 |
| Merge       | A merge into the default branch still walks the ticket one unforced step at a time from any open stage (ADR-0067), now without Monitoring: from Ready for review it records a single move to Done.                                       |
| Input       | `monitoring` is not a stage: the API, the ticket filter and MCP `move_ticket` reject it.                                                                                                                                                 |
| Stored data | `SCHEMA_VERSION` 3 (ARCHITECTURE §10.4). On read, a ticket stored in `monitoring` is Done (`ticketV2toV3`), and a `stage_changed` event's `from`/`to` read `monitoring` as `done` (`ticketEventV2toV3`). Other collections pass through. |
| M6          | M6: Dev → prod releases adds its own verification stage, named then ("Verifying" or "Released"), with a real exit signal.                                                                                                                |

### Consequences

- Good: the board and the MCP stage list only show stages that do something; a merge is one history entry from review.
- Bad: history entries that once said Monitoring now read Done (e.g. a `monitoring → done` move reads `done → done`). The stored documents keep the old value until rewritten; tickets are rewritten on their next write, events never are, so the event upgrader stays.
