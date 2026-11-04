---
status: accepted
date: 2026-11-04
---

# 0054 — Refine run protocol: structured output, questions once per run, auto-move to Ready

Built in M1.7: Refinement. Fills in ARCHITECTURE §4.3 and §7.2 where they left choices open; builds on ADR-0051 (executor run protocol).

## Context and Problem Statement

M1.6a's refine run returned a free-text report. M1.7 needs 1–5 questions back as records, written safely from untrusted agent output, and a ticket that reaches Ready when Andy has answered them. Open choices: how the result comes back, where the procedure lives, what stops duplicates and runaway runs, and who starts refine.

## Decision Outcome

| Topic             | Decision                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Result channel    | Structured output, not free text or a file (the run is read-only: no Write tool). `platform/procedures/refine.schema.json` goes to `claude-code-action` as `--json-schema`; the action fails the run if the agent returns no match. `executor-report.mjs` sends `structured_output` as `output` (≤ 48 KB; summary cut to 4,000 characters then).                     |
| Check             | The control plane is the check: `RefineOutput` (`@andy/contracts`) — summary ≤ 4,000 characters, 1–5 questions of ≤ 500, ≤ 5 options of ≤ 200, ≤ 5 assumptions of ≤ 300, no unknown fields. A test keeps the JSON schema's limits equal to it. A bad result fails the run with the reason; nothing is written.                                                       |
| Procedure         | `platform/procedures/refine.md` (vendor-neutral, ADR-0032). The workflow reads `<step>.md` and `<step>.schema.json` from the platform's commit, like the profile, and puts the procedure before the run's prompt (stable prefix, ADR-0046). The control plane's prompt holds only the role, the untrusted-data warning and the ticket snapshot with earlier answers. |
| Questions written | `WorkTracker.askQuestions`: one transaction, all or none. A run's question ids derive from the run (`<runId>-q<n>`) and `Question.runId` records it, so a replayed report finds them and writes nothing. Questions are written before the run is closed, so a crash between the two is finished by the replay.                                                       |
| Guards            | Refine starts only on a Backlog ticket with no open questions (answer first: the next pass sees the answers), at most 3 runs per ticket that reached the executor (ADR-0028). If the ticket left Backlog during the run, its questions are dropped and the run fails with the reason.                                                                                |
| Auto-move         | The last answer on a Backlog ticket whose DoR is met moves it to Ready as `system`, through `TicketService.move` (re-reads, re-checks the DoR, writes with `ifUpdatedAt`). A conflict or unmet DoR leaves it in Backlog and is logged; the answer stands.                                                                                                            |
| Who starts refine | Andy: UI button, `POST /api/projects/{p}/tickets/{t}/runs` or the MCP `refine` tool. Starting refine when a ticket is created belongs to the dispatcher in M1.8: Build + gate.                                                                                                                                                                                       |

### Consequences

- Good: no free-text parsing; the agent can't write questions to another ticket or change a stage; replays can't duplicate; a broken result leaves no partial state.
- Bad: two copies of the limits (JSON schema for the agent, Zod for the check), held together by a test. The DoR still needs a tier, which refine doesn't set, so Andy sets it before the last answer. A ticket with nothing to ask must still produce one question.
