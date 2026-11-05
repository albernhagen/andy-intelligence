---
status: accepted
date: 2026-11-05
amends: 0056, ARCHITECTURE §4.1
---

# 0067 — PR events move a ticket from any open stage

Built in AI-31: A merged PR completes its ticket from any stage, whoever wrote it. Amends ADR-0056: A merged PR completes its ticket.

## Context and Problem Statement

Under ADR-0056 a PR moved its ticket only from Ready or later; a Backlog ticket got the link and nothing else. On 2026-11-04 and 2026-11-05 five PRs written in Claude Code sessions merged while their tickets sat in Backlog, and Andy dragged each to Done by hand. Andy will also write code himself, so a PR must move its ticket whoever wrote it and wherever the ticket sits.

## Decision Outcome

| Topic        | Decision                                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opened       | A non-draft same-repo PR into the default branch moves its ticket to Ready for review from Backlog, Ready or In progress.                                                                                                                                                       |
| Merged       | A PR merged into the default branch completes its ticket (to Done, via Monitoring) from any stage except Done and Cancelled.                                                                                                                                                    |
| Link only    | Drafts, PRs into other branches, Cancelled or archived tickets, and epics (they never run). Closed unmerged is unchanged.                                                                                                                                                       |
| How it moves | One named path, `TicketService.followPullRequest` (`packages/domain`): every step of the pipeline in order, as `system`, unforced, with the PR link as the reason. It skips only the Definition of Ready check: the work exists. It is not a general "system may force" switch. |
| On Done      | Open questions are withdrawn and Needs-you clears, as on cancel (AI-15).                                                                                                                                                                                                        |
| Replays      | Still no-ops: the delivery log records each delivery ID once.                                                                                                                                                                                                                   |

### Consequences

- Good: human and agent PRs flow through tickets the same way; nobody drags merged work to Done.
- Bad: anyone who can push a branch to the repo (Andy, his agents) can complete a ticket that never met the DoR, and the ticket's open questions are dropped. History shows each step with the PR link, so it is traceable.
