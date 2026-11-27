---
title: Promote and rollback as recorded release requests, matched to the workflow's reports
status: proposed
date: 2026-11-26
amends: 0114 (how the control plane starts release.yml and tracks the run)
---

# 0160 — Promote and rollback as recorded release requests

AI-199: M6.12: Promote and rollback from UI and MCP, under AI-153: M6: Dev → prod releases. Andy approved the plan on 2026-11-26, with a queued check for runs GitHub cancels.

## Context and Problem Statement

ADR-0114 says the owner promotes and rolls back from the UI and MCP by starting the project's `release.yml` (`workflow_dispatch` on `main`, App token), one request per project per minute. It leaves open what the control plane stores, how a workflow's report is tied to the click that started it, and what happens when GitHub cancels a waiting run (a deploy to the same environment replaces it in the queue). This is a new way to change prod traffic, so who asked and what happened must be on record.

## Decision Outcome

| Topic         | Decision                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record        | A `ReleaseRequest` per click or tool call (`releaseRequests` in Firestore, server-only): project, action, environment, the digest that will serve (and the revision for a rollback), its source deployment, the actor (`user:<uid>`), times, the workflow run, the reported deployment, status and error. It is the audit record.           |
| Service       | One `ReleaseService` in `@andy/domain` behind `POST /api/projects/{id}/releases/promote`, `…/rollback` and MCP `promote`, `rollback`; `GET …/releases/requests` and `list_release_requests` read the records. Owner only (`requireCan(…, "release")`).                                                                                      |
| Refusals      | `deployKind` `none` (both); `prod-only` (promote, and rollback of dev); a digest or revision no succeeded deployment of that project and environment has; prod already serving that digest; rollback to what serves now. Each says why; nothing is recorded or dispatched.                                                                  |
| Rate cap      | `create` refuses a project's request within 60 seconds of its previous one, in the same Firestore transaction as the write (a per-project lock document), so both API instances share it. `429`.                                                                                                                                            |
| Dispatch      | After the record: `CodeHost.dispatchWorkflow(repos[0], "release.yml", { action, environment, digest, revision, request })`. A refusal (the App lacks `actions: write`: `403`) marks the request `dispatch_failed` with the reason and answers `502`; the App is never widened.                                                              |
| Match         | A `release.yml` start report that names a `request` must match a stored request of the same project, action, environment and digest, not matched before; else `422` and nothing is recorded. An empty `request` (a run started by hand) is recorded as before. The request then follows its deployment: `started`, `succeeded` or `failed`. |
| Cancelled run | Each dispatch queues a check on the watchdog queue 45 minutes later (again every 45 minutes while the run is going, up to 6 hours). A run that ended `cancelled` marks the request `cancelled`; any other end without a finish report marks it `ended_unreported`. Both show on the Releases page and in `list_release_requests`.           |

### Consequences

- Good: every change to prod traffic from the control plane has a record of who asked and how it ended; a report can't claim a request it doesn't match; the cap holds across instances; nothing new to run or pay for (the watchdog queue exists).
- Bad: a cancelled run is shown, not pushed to Needs-you (a follow-up); a rollback whose start report is refused still runs unrecorded (ADR-0114's rollback is ungated on purpose); one more collection and one more queued-check kind.
