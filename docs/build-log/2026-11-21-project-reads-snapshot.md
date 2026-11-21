# 2026-11-21 — Dashboard, digest, epic status, What's new and milestone map read through the snapshot (AI-318)

**What:** five readers listed every ticket of the project on each call. At project AI's size (about 315 tickets) that was 673 reads for the dashboard, 457 for the digest, 392 for epic `status`, 319 for What's new and 318 for the milestone map, every call.

**Fix:** they read the project's tickets through the AI-317 snapshot (ADR-0133): one counter read, plus the tickets changed since the last call (`ProjectTickets`). Also:

- The dashboard keeps each ticket's stage moves for its `updatedAt`, since a stage move always changes the ticket. It re-reads a history only for a changed ticket, and keeps at most 5,000 per instance.
- The milestone map reads each in-review ticket's latest PR link (`pr_linked` events only), not its whole history.

| Read (`project-reads.test.ts`, 40 / 300 tickets) | Unchanged | After one write | After ten writes |
| ------------------------------------------------ | --------- | --------------- | ---------------- |
| Dashboard                                        | 3         | 7               | 44               |
| Digest                                           | 17        | 21              | 58               |
| Epic status (REST / MCP)                         | 15 / 36   | 15 / 36         | 15 / 36          |
| What's new                                       | 3         | 3               | 3                |
| Milestone map                                    | 5         | 5               | 5                |

Each count is the same at 40 and 300 tickets, and each response equals a full read's. The digest still reads the history and agent tasks of each ticket changed in its window (capped at `MAX_DIGEST_TICKET_READS`).
