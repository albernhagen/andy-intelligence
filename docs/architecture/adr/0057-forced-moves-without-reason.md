---
status: accepted
date: 2026-11-04
amends: ARCHITECTURE §4.1
---

# 0057 — Forced stage moves no longer need a reason

Decided by Andy, 2026-11-04, with AI-16: Board drag-and-drop; forced moves no longer need a reason.

## Context and Problem Statement

ARCHITECTURE §4.1 said "Andy can force any move with a reason". With drag-and-drop on the board (pulled forward from M5: Epics + story board), a drop onto a column the stage rules don't allow is a forced move. A mandatory reason turns every such drop into a form: a speed bump for the one user who is allowed to force, with no reader for most reasons.

## Decision Outcome

| Topic       | Decision                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reason      | Optional on every forced move (domain, API, UI, MCP). A blank reason is stored as none. The `reason_required` error is gone.                     |
| Audit trail | Unchanged: the `stage_changed` event keeps `forced: true` and the actor; the reason is its body when given. History shows "force-moved".         |
| Who         | Unchanged: only Andy can force; agents and the system get `forbidden`.                                                                           |
| Board drop  | An allowed transition sends a normal move (rules still apply, e.g. the DoR on Backlog → Ready); any other column sends a forced move, no reason. |

### Consequences

- Good: moving a ticket is one drag; history still says which moves skipped the rules and who made them.
- Bad: forced moves usually carry no "why"; Andy can still add one from the ticket page's "Force move…" form, or a comment.
