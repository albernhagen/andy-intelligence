# 2026-11-21 — Board and ticket list read only changed tickets (AI-317)

**What:** after any ticket write, the board read about 370 documents and the ticket list 319 at project AI's size (about 315 tickets). It was the second offender behind the Firestore reads alert (22,541 reads in an hour). The first was dispatch, fixed in AI-315.

**Why:** the change counter (ADR-0126) only helps an unchanged project. While agents work, tickets change about every minute, so nearly every 5 s poll was a full read.

**Fix (ADR-0133):** a per-instance snapshot of each project's tickets, refreshed on a new counter value by the tickets changed since the newest seen (60 s overlap). PR links are read per in-flight card from `pr_linked` events only.

| Read (`board-reads.test.ts`)                 | 40 tickets | 300 tickets |
| -------------------------------------------- | ---------- | ----------- |
| Board, cold start                            | 47         | 307         |
| Board, unchanged                             | 1          | 1           |
| Board, after one write                       | 9          | 9           |
| Ticket list, after ten writes (polled first) | 12         | 12          |

**Follow-ups:** the dashboard, digest, What's new, milestone map and epic `status` each list the whole project per call; they can read through the same snapshot (one ticket). Needs-you reads flagged tickets and open questions across projects; it needs its own.
