---
status: accepted
date: 2026-11-09
amends: ADR-0058 (the "worker" role, single-user form)
---

# 0082 — The worker role for one user

Decided by Andy, AI-32: Who does the work.

## Context

Andy wants most projects built by agents, and some work, or a whole project, kept for himself. ADR-0058: Ticket model names three roles for later (requester, owner, worker). Only the worker changes what the system does today.

## Decision

| Topic           | Decision                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Values          | Project `defaultWorker`: `agent` (default), `me`, `ask`. Ticket `overrides.assignee`: `agent`, `me`, or a harness key, which counts as `agent`; empty follows the project.                                            |
| Resolution      | `resolveWorker(ticket, project)`, pure, at read time. Never copied onto the ticket, so no migration, and a default change applies to every ticket without its own pick, at any stage.                                 |
| `ask`           | No worker until Andy picks one.                                                                                                                                                                                       |
| Builds          | Only a resolved `agent` builds (`isDispatchable`). Both the dispatcher and a by-hand start refuse `me` and `ask`.                                                                                                     |
| Refine          | Not gated on the worker: Andy may want the questions and the draft on his own tickets.                                                                                                                                |
| Attention       | A `me` ticket in Ready or In progress shows "Waiting on you"; `ask` shows "Needs a worker". Neither is an inbox item: the inbox is for things only Andy can unblock now, and these wait on his own time or attention. |
| Switching       | `set_worker` / `PUT .../worker`; `null` clears the pick, which is separate from picking `agent`. A switch to an agent asks the dispatcher to run.                                                                     |
| A run in flight | A switch doesn't stop it; taking over mid-run is out of scope. Its retry is refused once the worker isn't an agent.                                                                                                   |

## How it grows (AI-18: Project members, M8: Project members)

`me` means the single allow-listed user. With members, `me` becomes a person's id, `overrides.assignee` holds a member or an agent, and `ask` stays "nobody yet". Requester and owner are added then as ADR-0058 describes; attention follows the owner, while the worker only decides who builds. `resolveWorker` stays the one place that answers the question.

## Consequences

- Good: one optional project field and one more override value; no write to existing tickets; no `SCHEMA_VERSION` bump.
- Bad: every board and `status` read needs the project document (one extra read for `status`); `me` is not yet a real identity, so it will need rewriting when members arrive.
