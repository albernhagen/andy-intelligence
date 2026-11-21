---
title: Board and ticket list refresh from the tickets changed since the last read
status: proposed (AI-317; Andy decides at review)
date: 2026-11-21
amends: 0126 (the cache)
---

# 0133 — After a change, the board and ticket list read only the changed tickets

AI-317: Board and ticket list re-read every ticket after any change. It was the second offender behind the Firestore reads alert of 2026-11-21 (22,541 reads in an hour against 20,000).

## Context and Problem Statement

ADR-0126's change counter makes an unchanged poll one read. But every write moves the counter, and while agents work, tickets change about every minute. So almost every poll was a full read: about 370 documents for the board and 319 for the ticket list at project AI's size (about 315 tickets). An open tab polls every 5 s while an agent task runs.

## Considered Options

1. **Keep each project's tickets per instance; on a new counter value, read only the tickets changed since the newest one seen** (`updatedAt` at or after it, less an overlap window).
2. **Per-lane queries.** Still reads every open ticket on each change, and Done grows forever.
3. **Store a changed-ticket log per project.** One more write on every ticket change, and one more collection to keep in step.

## Decision Outcome

Option 1. The counter (ADR-0126) still decides _when_ to refresh; `updatedAt` only decides _which_ tickets to read.

- **Port:** `WorkTracker.listTicketsChangedSince(projectId, since)`. On Firestore it's one range filter on `updatedAt`: a single-field index, no composite one.
- **`TicketSnapshots`** (domain) keeps each project's tickets per instance. The first read reads all of them. Each new counter value reads the tickets changed since the newest `updatedAt` seen, less 60 s, and merges them in. Tickets are never deleted (archiving is a change), so the merged set stays whole.
  - **Why the overlap:** ADR-0126 rejected `updatedAt` as the marker because two instances' clocks can differ and a write can still be committing. The 60 s overlap covers both; it re-reads only the tickets changed in that minute.
  - **Caps (ADR-0028):** a full re-read every 60 minutes bounds any drift; at most 200 projects per instance.
- **The board** reads the snapshot, open questions and active agent tasks. Each card In progress or Ready for review reads only its `pr_linked` events (new `WorkTracker.getLatestPullRequest`), not its whole history, still capped at 50 cards. A PR link doesn't change its ticket (the port says so), so links are read per card on each refresh, not merged.
- **The ticket list** filters the same snapshot in memory, so the board and list share one refresh.
- **Archived tickets** are read once, at the first read; after that only when they change.

### Consequences

- After one write, the board reads about 9 documents (3 in-flight cards) and the list 2, at any project size. Before: about 370 and 319.
- A first read after an instance starts (or every 60 minutes) still reads every ticket.
- Writes from outside the app that don't bump the counter show within 5 minutes (ADR-0126), and their tickets are picked up by the next changed-since read.
