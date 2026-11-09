# 2026-11-09 — AI-32: Who does the work

- Built the single-user worker role (ADR-0082: The worker role for one user): project `defaultWorker` (`agent`, `me`, `ask`), an explicit `agent` override, `resolveWorker` and `isDispatchable` in `packages/domain/src/worker.ts`.
- The dispatcher and by-hand builds refuse `me` and `ask`; refine still runs. A switch to an agent asks the dispatcher to run.
- UI: "Mine", "Waiting on you" and "Needs a worker" markers on the card and rail, one-click switch in the rail, default worker on `/projects`. The board's "Next" skips tickets no agent can take. None of these are inbox items.
- MCP `set_worker`, `set_default_worker`; `status` and `list_needs_me` return the resolved worker. REST `GET`/`PUT .../worker`.
- No `SCHEMA_VERSION` bump (optional field, resolved at read time); no `terraform apply`.
