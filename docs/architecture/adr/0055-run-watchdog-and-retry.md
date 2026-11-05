---
status: accepted
date: 2026-11-04
---

# 0055 — Run watchdog and retry: one check per run, a retry is a new Run, reported failures retry too

Built in M1.6b: Claude Code executor: watchdog + retry. Fills in §7.1 "Run watchdog" and the §12 row, which left these choices open.

## Context and Problem Statement

§7.1 says a Cloud Tasks task at each run's deadline checks the executor once, then heals the record or flags Needs-you; §12 adds one automatic retry. It doesn't say what a retry is, which failures retry, or how the queue stays bounded.

## Decision Outcome

| Topic           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port            | `WatchdogQueue.schedule({ runId, at })` in `@andy/contracts`, idempotent by run ID; Cloud Tasks adapter in `@andy/store` names the task after the run, so Cloud Tasks itself refuses a second one.                                                                                                                                                                                                                                                                                     |
| When            | Queued right after a dispatch is recorded. A queue error is logged, not fatal: the run works, and stops blocking new runs at its deadline anyway.                                                                                                                                                                                                                                                                                                                                      |
| Check           | `POST /runs/{id}/watchdog`, Google OIDC token for `tasks-invoker`, audience `PUBLIC_URL` (§9). A run that already reported: no-op. Before the deadline: `503`, so Cloud Tasks delivers again later. Otherwise one `CodeHost.getWorkflowRun` via the executor: success → heal (`succeeded`, `error` notes the lost report); failed → `failed`; cancelled → `cancelled`; still queued or running → cancel it, `cancelled`. Executor errors answer `500`; the queue retries (3 attempts). |
| Retry           | A new Run (`attempt: 2`, `retryOf`: the first run's ID) started through the normal start path, so it gets its own prompt, cap check, callback identity and watchdog check. Status changes are conditional, so only the call that ends a run can start its retry.                                                                                                                                                                                                                       |
| Which failures  | Any end that isn't success: a reported failure, a failed or killed workflow, an overdue run. A failed second attempt, or a retry that can't start (e.g. another run in flight), flags the ticket Needs-you with a comment.                                                                                                                                                                                                                                                             |
| Caps (ADR-0028) | `MAX_RUN_ATTEMPTS` = 2; one check per run; checks in the queue ≤ runs in flight (one per project); queue 5/s, 5 concurrent, 3 attempts (Terraform).                                                                                                                                                                                                                                                                                                                                    |

### Consequences

- Good: no polling and nothing queued without a run; replays and late checks change nothing; a retry is auditable on its own Run.
- Accepted: a reported failure dispatches its retry inside the report request (a few Firestore calls and one GitHub dispatch). Retry errors never fail the report (it still answers "recorded"); a slow dispatch can make the `report` job log a timeout, and its re-post is a no-op.
- Accepted: if the instance dies between ending a run and starting its retry, the queue's redelivery finds the run settled, so it is neither retried nor flagged. The run shows its end and `error`; rare enough not to add a two-step flag.
- Bad: cancelling a run by hand in Actions counts as a kill and retries once (the executor can't tell who cancelled); cancel the retry too.
- Bad: a run that fails for a reason a retry can't fix (a bad ticket) spends a second run of quota; the Needs-you flag has no UI toggle yet; if GitHub is down at the deadline for all three deliveries, the run stays `running` (logged).
