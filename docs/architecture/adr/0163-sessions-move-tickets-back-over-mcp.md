---
title: Sessions may move a ticket back any number of stages over MCP; forward stays one step
status: proposed
date: 2026-11-27
amends: 0056 (backward moves were UI-only)
---

# 0163 — Sessions may move a ticket back over MCP; forward stays one step

AI-397: MCP move_ticket: allow backward moves; forward stays one step. Andy, 2026-11-26: "I also think MCP should allow moving tickets backwards more but not forward more than 1 step."

## Context and Problem Statement

MCP `move_ticket` allowed only one step forward; ADR-0056 kept forced and backward moves in the web app. On 2026-11-26 a session could not move five stale In progress tickets back to Backlog, and Andy did it by hand. Moving back skips no review or gate, so it need not be Andy's alone; moving forward past a stage would skip the Definition of Ready (DoR) or review, so it stays one step.

## Decision Outcome

| Topic           | Decision                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forward         | Unchanged: one stage at a time; Backlog → Ready checks the DoR; Verifying only for projects that deploy. Skipping forward is refused with the reason.                                                                                                                                                                                                                                                            |
| Backward        | `move_ticket` moves a ticket to any earlier pipeline stage (Backlog, Ready, In progress, Ready for review) in one call, unforced, with the session's MCP identity as the actor in history. Into Ready it checks the DoR, as forward does. Out of Verifying (merged, deploying) only to In progress, the failed-verification move that flags Needs-you (ADR-0114). Same stage or Cancelled get their own refusal. |
| Backlog         | A ticket moved back to Backlog lands in Ideas: the tracker clears `upNextRank` when it leaves Backlog (AI-395) and the session path takes no Up next option, so no refine or build starts on it.                                                                                                                                                                                                                 |
| Done, Cancelled | A session may not move a ticket out of Done or Cancelled; Andy does, in the web app (default for AI-397 question 1).                                                                                                                                                                                                                                                                                             |
| In flight       | A session's backward move is refused, with the reason, while an agent task is queued or running on the ticket or its latest PR is open (default for AI-397 question 2). Andy's forced move is not checked: it neither stops the task nor closes the PR.                                                                                                                                                          |
| Code            | `isBackwardMove` in `packages/domain/src/stages.ts`; `TicketService.moveBySession` (was `moveForward`). No new permission: forced moves stay owner-only (ADR-0057).                                                                                                                                                                                                                                              |

### Consequences

- Good: sessions can clean up stale tickets without Andy; nothing a session does skips the DoR, review or a gate; history records who moved it.
- Bad: a session can undo progress (e.g. pull a ticket out of review). It is visible in history and Andy can move it forward again; Done, the stage releases and metrics count, stays protected.
- Moving back to Ready makes the ticket buildable again, as any move into Ready does (ADR-0063); the DoR check keeps an incomplete ticket out of it.
