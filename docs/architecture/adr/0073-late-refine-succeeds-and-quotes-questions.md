---
status: accepted
date: 2026-11-08
amends: 0054 (Guards)
---

# 0073 — A refine that finishes after its ticket left Backlog succeeds and quotes its questions

Built in AI-61: Refine reports failure when its ticket left Backlog before it finished. Amends ADR-0054: Refine run protocol.

## Context and Problem Statement

ADR-0054 dropped the questions and failed the run if the ticket left Backlog during it. A ticket created with every Definition-of-Ready field filled can reach Ready while its automatic refine run is going, so valid runs reported "The refine run failed" (AI-49: Sandbox probe script (second chore), AI-60: Add a comment to .github/workflows/ci.yml). Nothing had gone wrong, and the failure comment was noise.

## Decision Outcome

Decided by Andy, 2026-11-08.

| Case                                         | Outcome                                                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Valid result, ticket left Backlog during run | The run succeeds. No questions and no refine fields are written, and the ticket is not flagged Needs-you. The ticket comment has the summary, says the ticket moved on and quotes the questions. |
| Malformed result, or the ticket is gone      | The run fails, as in ADR-0054.                                                                                                                                                                   |

### Consequences

- Good: a failed refine again means something went wrong; Andy can still read what refine would have asked.
- Bad: nothing waits for the quoted questions. A build may already be running on assumptions refine questioned.
