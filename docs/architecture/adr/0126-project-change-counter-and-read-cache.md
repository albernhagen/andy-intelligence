---
title: Per-project change counter and read cache for board and ticket-list polls
status: accepted
date: 2026-11-21
amends: 0028 (caps), 0091 (live updates by polling)
---

# 0126 — A per-project change counter lets unchanged board and ticket-list polls skip reading tickets

AI-222: Firestore reads grow with project size. Andy's usage alert fired at 25,063 Firestore document reads in one hour against a 20,000 threshold.

## Context and Problem Statement

The UI keeps the board and the ticket list fresh by polling (ADR-0091): every 60 s when idle, every 5 s while an agent task runs. Each poll read every ticket in the project. Project AI has about 220 tickets.

| Read                        | Before (documents)                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Board poll                  | ~220 tickets, open questions, active agent tasks, one history list per card In progress or Ready for review |
| Ticket-list poll            | ~220                                                                                                        |
| MCP `status` for one ticket | ~220 tickets, plus the ticket's own reads                                                                   |

One idle tab for an hour is 60 board and 60 list polls. At about 230 + 220 documents each, that's about 27,000 reads, which matches the alert. A tab with an agent task running polls the board 12 times a minute.

## Considered Options

1. **A per-project change counter, with a per-instance cache keyed on it.** Every write bumps the counter; a poll reads it first and serves its cached view while the counter is unchanged.
2. **A cache with a fixed lifetime only.** Simple, but Andy's own edits would show up late, and two instances would show different boards for the whole lifetime.
3. **The newest `updatedAt` as the marker** (one indexed read). It misses changes that don't touch a ticket document (questions, history, agent tasks), and clock skew between the two instances can hide a write.
4. **Server push** (websockets or server-sent events). It holds connections open, so instances never scale to zero, and it's out of AI-222's scope.

## Decision Outcome

Option 1.

- **Port `ProjectVersions`:** `get(projectId)` reads one document and `bump(projectId)` increments it. On Firestore that's `projectVersions/{projectId}` with `{ version }`, bumped by a blind `FieldValue.increment(1)`: no read, no transaction. It's a server-only collection, so the deny-all rules need no change.
- **Who bumps:** `bumpOnWrite` wraps the tracker and run store once, in `createServices`. Every tracker write (project, ticket, comment, PR link, questions) and run write (create, update) bumps its project after it lands. Reads don't bump.
- **The cache:** `ProjectReadCache` holds the board and each ticket-list filter per project. It reads the counter, serves the cached view if the counter matches and the entry is under 5 minutes old, and otherwise loads it and caches it under the counter value read before loading. It keeps at most 200 views per instance, dropping the oldest (ADR-0028).
- **Why two instances stay correct:** the counter lives in Firestore and is read on every poll, so a write on one instance changes what the other reads next. A bump happens before the write's response returns, so once Andy sees his change saved, the next poll on either instance reloads. Increments from both instances all count. A write during a load moves the counter past the cached value, so the next poll loads again.
- **Staleness accepted:** none in normal operation. If a bump fails (logged as ERROR) or something writes outside the app, a view can be stale for at most 5 minutes. If reading the counter fails, the view loads without the cache (logged as ERROR), as it did before.
- **Also narrowed, no decision needed:** `status`, the inbox, the in-flight view and ticket writes now read the tickets they need, by key, blocker chain, parent chain or lane. Chains are capped at 200 reads.

## Consequences

| Read                                      | After (tests at 10 and 200 tickets) |
| ----------------------------------------- | ----------------------------------- |
| Unchanged board poll                      | 1 (the counter)                     |
| Unchanged ticket-list poll                | 2 (project and counter)             |
| MCP `status` for a story with one blocker | 11                                  |

- Good: an idle tab for an hour costs about 180 reads instead of about 27,000. Reads no longer grow with ticket count; a test (`apps/api/src/reads.test.ts`) fails if they do again.
- Bad: one extra Firestore write per write. That's far fewer than the reads it saves.
- Bad: a changed board still reloads in full, so a busy hour with many writes saves less.
- Not changed: an epic's `status` still reads its project for the roll-up; dashboards and the digest are out of scope.
