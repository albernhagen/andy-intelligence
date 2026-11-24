---
title: "Runners can be listed over MCP; minting and revoking stay in the app"
status: accepted (Andy, 2026-11-22; AI-294); amended by 0143
date: 2026-11-22
amends: 0089 (local executor: runner secret credential row)
---

# 0135 — Runners can be listed over MCP

AI-294: Parity: list runners over MCP, under AI-285: Web UI and MCP parity.

## Context

ADR-0089: Local executor's credential table says "MCP can't mint, list or revoke runners", so a stolen MCP token learns nothing about runners. AI-285 wants every Runners-page action in both the web UI and MCP. The Runners page lists runners with `GET /api/runners` (`RunnerService.list`), which returns no secret or hash.

## Decision

Andy decided on 2026-11-22: runners may be listed over MCP.

| Action          | Web UI / REST       | MCP                                                            |
| --------------- | ------------------- | -------------------------------------------------------------- |
| List            | `GET /api/runners`  | `list_runners`: same service call, read-only, same callers     |
| Register (mint) | `POST /api/runners` | None: the secret is shown once and must not land in a chat     |
| Revoke          | `POST …/:id/revoke` | None for now: AI-351: Parity: revoke a runner over MCP decides |

- `list_runners` returns what the route returns: name, project ids, agent tasks at once, who registered it and when, expiry, last seen, presence and state. Never a secret or its hash.
- Callers: allow-listed users, as for the route. No owner check until AI-18: Project members; the route and the tool get one together then.

## Why

- Parity: Andy can see his runners from Claude as from the Runners page.
- Listing is read-only and secret-free, so a stolen MCP token still can't add, revoke or impersonate a runner.

## Consequences

- A stolen MCP token (1 h access, 30-day refresh) can read runner names, project ids, presence and expiry: when Andy's Mac is online. Risk: `docs/security/risks/R-AI-294.md`.
- ADR-0089's body is unchanged; its status notes this amendment.
