# 2026-11-21 — Needs-you reads through the project snapshots (AI-319)

**What:** Needs-you (`GET /api/needs-you`, MCP `list_needs_me`, the inbox count in `status`) read 110 documents per call at project AI's size (about 315 tickets). Most of that was every archived and every cancelled ticket of every project, read only to hide their questions.

**Fix:** each project's tickets now come from its AI-317 snapshot (`ProjectTickets`, ADR-0133). Flagged, archived and cancelled tickets are filtered in memory. The open questions are still one query across projects.

| Read (`project-reads.test.ts`, 40 / 300 tickets) | Unchanged | After one write | After ten writes |
| ------------------------------------------------ | --------- | --------------- | ---------------- |
| `GET /api/needs-you`                             | 4         | 4               | 4                |
| MCP `list_needs_me`                              | 13        | 13              | 13               |
| MCP `status` (overview)                          | 7         | 7               | 7                |

Each count is the same at both sizes, and the REST response equals a full read's. A project's first call, or the first after an hour, still reads all its tickets once.
