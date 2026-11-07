---
status: accepted, amended by 0067, 0069
date: 2026-11-04
---

# 0056 — A merged PR completes its ticket until M6: Dev → prod releases

Built in AI-14: Tickets move on PR events. Deviates from ARCHITECTURE §4.1 for now: Monitoring's exit ("dev verification passed") isn't checked.

## Context and Problem Statement

Tickets reached Done only when Andy moved them. AI-14 makes PR webhooks move tickets as `system`, and Andy asked that a merge mean Done. Nothing verifies dev deployments before M6: Dev → prod releases, so Monitoring has no signal to exit on and tickets would sit there forever.

## Decision Outcome

- A same-repo PR **merged into the repo's default branch** walks its ticket Ready for review → Monitoring → Done, one unforced step at a time, as `system`. Merges into other branches only link the PR.
- Monitoring → Done stays an allowed one-step move, so MCP `move_ticket` (Andy's sessions) can also complete a ticket; forced and backward moves stay UI-only.
- M6: Dev → prod releases replaces the walk: a merge moves the ticket to Monitoring, and dev verification moves it to Done. This ADR is then superseded.

### Consequences

- Good: tickets close without Andy; no new transition in the stage machine.
- Bad: Done means "merged", not "verified in dev", until M6. A bad merge is caught by CI and review only.
