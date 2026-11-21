# 2026-11-21 — AI-311: M4.38: Milestone status on the epic panel and board

ADR-0131: Milestones (UI row), after AI-304: M4.34 (the milestone routes) and AI-202: M4.26 (the roadmap screen).

- **Chip:** `MilestoneControls.tsx` shows "name · status" on the epic panel's rail and on the board's epic group headers. A board group is its direct parent epic, so a child epic's header uses its top-level epic's milestone (`milestoneOf`). The board reads the milestone list only while it is grouped.
- **Owner's controls:** a top-level epic picks its milestone and sets that milestone's status, and an open roadmap row sets its status. These are select fields that save on change, like the other fields in the rail. Every write goes through the AI-304 routes, so the API refuses anyone but the owner and logs the change. The web hides nothing per role, which matches the other owner-only settings.
- **Held ticket:** `listedMilestoneHold` (domain) applies dispatch's rule to data the panel already loaded (the tickets and the milestone list). Its status line then reads "Waiting: Milestone … is parked", as MCP `status` does. A milestone missing from the list holds the ticket, as a failed read does in dispatch.
- **Generated client:** `gen-api.ts` now passes an in-memory milestone store, so the OpenAPI document (and `api.gen.ts`) includes the milestone routes. They are registered only when a store is configured.
- **Screenshots:** OPS's seeded epic is in a parked milestone: `board-grouped.png`, `story-panel-epic.png` and the new `epic-milestone.png`. The roadmap's open row now has its status field (`roadmap.png`, `phone-roadmap.png`).
