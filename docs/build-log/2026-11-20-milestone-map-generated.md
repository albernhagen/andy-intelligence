# 2026-11-20 — Milestone map generated from tickets (AI-148)

The hand-edited "Milestone map" table in `docs/build-log.md` went stale within hours, made concurrent PRs conflict on the same rows, and on 2026-11-20 pushed the file over its 800-word budget and turned `main` red. Tickets already hold stage, parent epic, blockers and linked PRs.

- **Built:** `MilestoneMapReader` (`packages/domain/src/milestone-map.ts`), `GET /api/projects/{p}/milestone-map` (`epic` optional) and MCP `milestone_map` (plain text first). Per open epic: done, in review with the last linked PR, in progress, blocked (and on which keys), not started; "needs Andy" marks Needs-you; open tickets under no epic listed.
- **Reads (ADR-0028):** one ticket list; at most 50 histories (PR numbers of tickets in review); at most 20 epics and 50 unassigned keys. Past a cap the map says `Partial`. Blockers in other projects count as open (not read).
- **Chose a tool over a generated file:** a committed generated file still conflicts when two PRs regenerate it; a read on demand cannot.
- **No UI view:** the board's epic grouping (AI-86) and the epic panel (AI-85) already show each epic's stories.
- **Docs:** the table is gone from `docs/build-log.md`; its Andy-only items moved to "Blocked on Andy". Rules in `AGENTS.md`, `docs/BUILD-PROMPT.md`, `platform/procedures/coordinate.md` and runbook `coordinating-sessions.md` no longer ask anyone to maintain a map.
