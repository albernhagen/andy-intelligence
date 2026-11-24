---
title: "The owner can revoke a runner over MCP; minting stays in the app"
status: accepted (Andy, 2026-11-23; AI-351)
date: 2026-11-23
amends: 0135 (runners over MCP: revoke row), 0089 (local executor: runner secret credential row)
---

# 0143 — The owner can revoke a runner over MCP

AI-351: Parity: revoke a runner over MCP, under AI-285: Web UI and MCP parity.

## Context

ADR-0089: Local executor kept runners out of MCP. ADR-0135: Runners can be listed over MCP allowed `list_runners` only and left revoking to this ticket. The Runners page revokes with `POST /api/runners/:runnerId/revoke`, which calls `RunnerService.revoke`: owner only (`revoke_runner` in `permissions.ts`), logs "runner revoked", and the runner's next claim is refused.

## Decision

Andy decided on 2026-11-23: revoking a runner is allowed over MCP, owner only. It only removes a credential; it never creates or reveals one.

| Action          | Web UI / REST       | MCP                                                            |
| --------------- | ------------------- | -------------------------------------------------------------- |
| List            | `GET /api/runners`  | `list_runners` (ADR-0135)                                      |
| Register (mint) | `POST /api/runners` | None: the secret is shown once and must not land in a chat     |
| Revoke          | `POST …/:id/revoke` | `revoke_runner`: same service call, same owner check, same log |

- `revoke_runner` takes a runner id (from `list_runners`) and returns the revoked runner's view, never a secret. An unknown id is "not found", as the route's 404. Revoking twice changes nothing.

## Why

- Parity: Andy can cut off a lost or misbehaving runner from Claude without opening the app.
- Revoking can't add access: the worst a stolen MCP token does with it is stop Andy's runner, which he fixes by registering a new one in the app.

## Consequences

- A stolen MCP token (1 h access, 30-day refresh) can revoke every runner: `local` tickets wait (or go to Actions per project default) until Andy registers a new one. Risk: `docs/security/risks/R-AI-351.md`.
- Bodies of ADR-0089 and ADR-0135 are unchanged; their status lines note this amendment.
