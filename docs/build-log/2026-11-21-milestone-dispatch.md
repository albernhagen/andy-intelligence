# 2026-11-21 — AI-306: M4.36: Dispatch starts only tickets in approved milestones

ADR-0131: Milestones, rule row: refine, build and night launch start a ticket only when its milestone is approved or it has none.

- `MilestoneHolds` (`packages/domain/src/milestone-holds.ts`): one dispatch pass's reasons. Each milestone is read once with `get`, never the project's `list`. Fails closed: a milestone that can't be read, a missing milestone, no store, or an epic chain that isn't loaded all hold the ticket.
- Build dispatch already read each Ready ticket's epic for its overrides (AI-116). It now also reads a child epic's parent, so a dispatch adds at most one epic read per child epic plus one read per milestone. `dispatch-reads.test.ts` checks this.
- New dispatch decision `milestone_held`, used when held tickets are the only reason nothing started. The web label reads "Ready tickets wait: their milestone isn't approved".
- Refine reads each Up next ticket's epics (at most two `getTicket` reads, shared across tickets) before its own checks, so a held ticket is never flagged by refine.
- A night launch gets the problem `milestone_not_approved`, with the reason as its message. The launch already read the project's tickets, so this costs no extra ticket reads.
- MCP `status` shows "Waiting: Milestone <name> is parked" (or "is not reviewed") for a held ticket in Backlog or Ready. Screens follow in AI-311: M4.38.
- Rollout: project AI has no milestones until AI-307: M4.37, so merging this changes nothing. Nothing writes `Ticket.milestoneId` until AI-304: M4.34, so the tests set it on the fake's stored ticket.
