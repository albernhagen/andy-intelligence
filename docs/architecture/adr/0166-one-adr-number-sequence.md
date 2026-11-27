---
title: One ADR-number sequence for build runs and sessions, with capped holds
status: proposed
date: 2026-11-27
amends: 0080 (reserved ADR numbers: sessions draw from the same counter)
---

# 0166 — One ADR-number sequence for build runs and sessions

AI-384: One ADR-number reservation for agents and sessions, proposed as P2 by spike AI-364.

## Context and Problem Statement

ADR-0080 reserves build runs' ADR numbers on a per-project counter (`counters/adr-{p}`, `last`), always above the highest `NNNN-*.md` on the default branch. Desktop sessions got numbers from a coordinator by hand. The two didn't know about each other, and parallel PRs clashed. Sessions need numbers from the same sequence, and a session can loop, so its reservations need caps and an end.

## Decision Outcome

| Topic       | Decision                                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sequence    | One per project: build runs and sessions both bump `counters/adr-{p}.last` to `max(highest on main, last) + 1` in a transaction. No second counter.                   |
| Entry point | MCP `reserve_adr_number { ticket }`, owner only (`reserve_adr_number` in `permissions.ts`) and project access on the ticket. MCP only: the web writes no ADRs.        |
| Holds       | A session's number is recorded as a hold in `holds` on the same counter document: number, holder (the ticket key), reserved and expiry times. Build runs record none. |
| Caps        | 5 open holds per ticket, 20 per project (ADR-0028), checked in the counter's transaction. At a cap the call is refused with the open holds listed.                    |
| End         | A hold ends when the ticket's PR into the default branch merges or closes (the PR webhook), or 7 days after it was taken.                                             |
| Reuse       | Never. Ending a hold frees the cap slot only; `last` never goes back. An unused number is a gap (like 0161), and no number whose file is on main is ever handed out.  |

### Consequences

- Good: sessions and build runs can't clash; a coordinator no longer counts files.
- Good: early or late release can't cause a clash, since numbers are never reissued.
- Bad: the sequence has more gaps. ADR numbers were never contiguous, and only the highest file matters.
- The build-run write now merges into the counter document so it keeps the holds.
