# 2026-11-21 — Firestore reads no longer grow with project size

- What happened: Andy's usage alert fired at 25,063 Firestore document reads in one hour (threshold 20,000). No loop: project AI has about 220 tickets, and MCP `status`, the board poll (every 5 s while an agent task runs), the ticket list poll, the in-flight view and ticket writes each read every ticket.
- Fix (AI-222: Firestore reads grow with project size):
  - `status` and the inbox read a ticket's blockers by key (and the Ready lane for a Ready ticket), not the project. Its agent tasks are read once, not twice.
  - The in-flight view reads only the tickets with an agent task in flight.
  - Ticket writes read the parent chain, the blocker chain or the ticket's lane, never the whole project. Lanes outside Done hold no archived tickets.
  - A `ProjectVersions` counter per project (`projectVersions/{projectId}`) is bumped by every tracker and run write. The board and ticket list cache their result per counter value, per instance, for at most 5 minutes. An unchanged poll is one counter read plus, for the list, the project read.
- Measured in tests (`apps/api/src/reads.test.ts`): `status` for a story with one blocker reads 11 documents at 10 and at 200 tickets; an unchanged board poll reads 1.
- Not changed: the alert threshold (Andy's), dashboards and digest reads, an epic's `status` (its roll-up still reads the project).
