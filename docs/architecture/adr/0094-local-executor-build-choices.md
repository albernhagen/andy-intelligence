---
status: proposed (AI-79; Andy decides at review)
date: 2026-11-11
amends: 0089 (what the control-plane side does where the design left it open)
---

# 0094 — Local executor: build choices on the control-plane side

AI-79: Local executor, control-plane side (ADR-0089 slices 2 to 4). ADR-0089 settles the design; building it needed six smaller choices the ADR leaves open. Each is the conservative one; reversing any is a small change.

## Decisions

| Topic                             | Choice                                                                                                                                                                                | Why                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Retries                           | No local run is retried on its own: lease lost, a reported failure, or the deadline flags Needs-you. ADR-0089 says this for a lost lease only.                                        | The automatic retry would start through the normal path, which can't hand a run to the runner; Andy decides, as for a lost lease. |
| Starting a `local` ticket by hand | A UI or MCP start of a ticket that resolves to `local` (or waits for an away runner) is refused (`409 runs_elsewhere`): the runner claims it, or Andy sets its executor to `actions`. | Keeps "a runner and Actions never both take a ticket" true for manual starts too.                                                 |
| Steps claimed                     | Builds (or the plan run a build needs), then refines. Sync runs stay on Actions until slice 6 (local build and publish).                                                              | A local sync needs the push token for local runs, which is slice 6.                                                               |
| Secret lookup cap                 | 60 runner-secret lookups a minute per instance, valid or not, before any lookup.                                                                                                      | "As on `/oauth/token`" (ADR-0089): that cap is per instance, not per IP.                                                          |
| Revoke                            | Revoking a runner also refuses its per-run tokens, so its runs in flight lose their lease and go to Needs-you.                                                                        | A revoke means stop now.                                                                                                          |
| Runner-away check                 | Queued at the claim plus 2 minutes and 5 seconds, so a claim on time cancels it in effect (the check finds the runner present).                                                       | Avoids waking the dispatchers between two on-time polls.                                                                          |

## Consequences

- Good: no path starts the same ticket on two executors; a local failure never re-runs without Andy.
- Bad: a flaky local failure needs Andy's click where an Actions run would retry once.
