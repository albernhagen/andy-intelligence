---
status: accepted
date: 2026-11-08
amends: 0054
---

# 0075 — Ideas and Up next on the Backlog stage; refine asks only when Andy beats a guess

Built in AI-39: Refine as the gate into the queue. Amends ADR-0054: Refine run protocol.

## Context and Problem Statement

Refine ran on every new Backlog ticket and had to ask 1–5 questions. The inbox reached 56 open questions on 15 tickets, and a dump of 50 ideas would spend a refine run each. Andy (2026-11-06): refine should ask only when his guidance beats a guess.

## Decision Outcome

Decided by Andy in AI-39's answered questions.

| Topic          | Decision                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model          | Stage stays `backlog`. `Ticket.upNextRank` null = **Ideas**; set = **Up next**, ordered by it. Older tickets read as Ideas, with no schema bump or migration. Leaving Backlog clears it.                                                                                                                                                                                                                   |
| Trigger        | Only entering Up next runs refine (also a create with `upNext`). Each entry runs once, inside the 3-runs-per-ticket cap; at the cap the ticket is flagged. Refine on an Idea is refused. Epics, Done, Cancelled and archived tickets are never refined.                                                                                                                                                    |
| Outcomes       | `ready` (gaps applied), `send_back` (back to Ideas with a one-line reason, nothing else written), `split` (at most 5 children in Ideas under the same epic, parent back with links).                                                                                                                                                                                                                       |
| Measured rule  | The result rates each gap: `cost` (`reversible`, `direction`, `scope`, `trust`, `spend`) and `confidence`. The control plane decides: sure and reversible is an assumption, the rest a question.                                                                                                                                                                                                           |
| Caps           | 3 open questions per ticket; `Project.dailyQuestionCap` (default 5) refine questions per project per rolling 24 hours. Past a cap, gaps become assumptions and the ticket's comment says so.                                                                                                                                                                                                               |
| Zero questions | Allowed everywhere. Nothing to ask and the Definition of Ready met: straight to Ready, no inbox item. Nothing to ask and it isn't met: flagged, not re-run.                                                                                                                                                                                                                                                |
| Fields         | Refine also proposes `body` and `acceptanceCriteria`, written only where empty, so a title-only idea can reach Ready.                                                                                                                                                                                                                                                                                      |
| Assumptions    | `Ticket.refineAssumptions`, listed in the panel and `status`. Promote (UI, MCP `promote_assumption`) opens a question; a Ready ticket returns to Up next; once In progress it's refused. Its answer starts a re-refine that sees only that gap (`focusGaps`), fills nothing, ignores `send_back` and `split`, and acts on at most one follow-up gap. Promoted questions don't count against the daily cap. |
| Back to Ideas  | Withdraws open questions; a promoted assumption reverts.                                                                                                                                                                                                                                                                                                                                                   |
| Stale flags    | A Done ticket clears `needsAttention` on arrival; the inbox leaves out a flagged Done ticket with no open question (AI-2).                                                                                                                                                                                                                                                                                 |

### Consequences

- The refine schema changed shape, so a run spanning the deploy fails; follow the deploy ordering in `docs/runbooks/ticket-core.md`.
- Open questions on tickets that now read as Ideas stay in the inbox until answered or withdrawn.
