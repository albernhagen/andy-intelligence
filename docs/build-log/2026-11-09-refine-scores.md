# 2026-11-09: AI-37: Refine scores each ticket

Refine now returns `risk` and `confidence`, each with a one-line reason, by a written rubric in `platform/procedures/refine.md`. Both fill only when empty, are optional and never block Ready.

- `packages/domain/src/scores.ts`: `startScore` ("S · low risk · confident"), shared by board and MCP; `sortByStartScore` for the Ready lane.
- Board: three markers on cards; "Sort by score" (`?sort=score`) is a view. While it is on, card numbers and Next stay the queue's, and a drop on Ready never reorders it.
- MCP: `status` adds `score`; new read-only `list_ready` (filters: size, risk, confidence; at most 100 tickets, `total` says how many matched).
- No `SCHEMA_VERSION` bump: optional fields with defaults. Tickets refined earlier show no markers.
- Refine results must now carry the four fields: a run that started on the old schema and reports after the deploy fails its check and can be rerun.
