---
status: accepted
date: 2026-11-11
amends: 0075 (refine as the gate into the queue)
---

# 0087 — A costly gap a question cap demoted holds the ticket

Decided by Andy, 2026-11-10 (digest decision 6: yes), from the security review's low finding on AI-39 (PR #111). The coordinator settled the details below on 2026-11-11, and Andy may override them. Built in AI-75: Refine: a costly open gap that a question cap demoted holds the ticket in Up next instead of becoming an assumption.

## Context and Problem Statement

ADR-0075 asks a question only when refine is unsure or a wrong guess is costly. It caps questions at 3 open per ticket and `dailyQuestionCap` per project per 24 hours. A gap past a cap became an assumption (`demotedBy`), and the ticket could still reach Ready. So a costly, hard-to-reverse guess could be built with no human asked.

## Decision Outcome

A **held gap** is an assumption with `demotedBy` set, `cost` other than `reversible`, and status `assumed` (`isHeld`, `packages/domain/src/dor.ts`).

| Rule               | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Holds              | The Definition of Ready misses "N held question(s) asked or accepted", so every path to Ready refuses the ticket: refine, the last answer, and a manual move. The ticket stays in Up next and is flagged Needs-you. Its status line says it waits on a held question and names the cap.                                                                                                                                                                                                    |
| Asked when allowed | The refine dispatcher's `askHeld` runs at the start of every dispatch event: an answer, a run ending, a ticket entering Up next, a switch turned on. It asks held gaps in Up-next order as far as both caps allow, and they count against the daily cap. There is no timer, so a gap held by the daily cap is asked at the first dispatch event after the window, not the moment the window opens. A paused project asks nothing. Asking needs no run, so it doesn't wait for auto-refine. |
| Promote            | Andy's existing "Ask me instead" (`POST …/promote`, MCP `promote_assumption`) still works on a held gap. Once asked, either way, its answer gets the focused re-refine of ADR-0075.                                                                                                                                                                                                                                                                                                        |
| Accept             | `POST …/assumptions/{id}/accept` and the ticket page's "Accept as an assumption" set the status to `accepted` (an additive enum value). The ticket is re-checked against the Definition of Ready and goes to Ready when nothing else is missing. Only a held gap can be accepted (`not_acceptable`, 409). There is no MCP tool until AI-19: One permission function lands.                                                                                                                 |
| Unchanged          | Reversible gaps refine was unsure of and a cap demoted still stand as assumptions. The caps and the confidence rule are unchanged.                                                                                                                                                                                                                                                                                                                                                         |
| Ids                | A held gap's question has `runId` `<assumption id>-h<try>`. It counts as refine's against the daily cap, a retry after a crash adopts the open one instead of asking twice, and a try withdrawn when the ticket left Up next gets a new id.                                                                                                                                                                                                                                                |

### Consequences

- Good: no costly guess reaches Ready without Andy seeing it.
- Bad: a quiet project asks a gap held by the daily cap late: at the next event, not at the moment the window opens. Andy can promote or accept it at any time.
- Bad: until AI-19, accepting a held gap is UI and REST only; over MCP, Andy promotes the gap and answers it instead.
