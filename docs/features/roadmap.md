# Roadmap data

A project's milestones in order, each with status (not reviewed, approved, parked), done (approved, every epic Done), progress and open-ticket counts over its epics; then epics with no milestone (AI-305, ADR-0131). Every top-level epic too, in rank order, with outcome, Done-when lines, state, progress and counts; child epics nest one level (AI-193). Computed on read, never stored. The Roadmap screen: one card row per milestone with its status pick (Not reviewed, Approved, Parked) in the row, parked dimmed, done compact, each expanding to its epics (AI-202, AI-378); filter All, Open, Parked or Done. A project with no milestones offers **Plan this project**: a plan-project agent task (refused while one runs or a plan waits).

**Milestones** (ADR-0131, ADR-0136): ordered groups of top-level epics. Andy creates, renames, reorders, sets status and attaches epics (their children follow) in web or MCP; each change is logged and revertable. Never deleted: park one.

**Case** (ADR-0149): who a milestone serves, the expected return, the cheapest test. An open not-reviewed row shows it, with effort (its non-Cancelled tickets by size, derived), or "No case written yet" (approving still works). Write, edit or remove it there or over MCP; logged. Plan approval stores the plan-project task's cases on milestones it creates approved.

**How to use:** MCP `list_milestones`, `create_milestone`, `edit_milestone` (both take `case`; `null` removes), `set_milestone_status`, `set_epic_milestone`, `roadmap`; or `/api/projects/ai/milestones`, `PATCH …/milestones/:id`, `PUT …/tickets/:id/milestone`, `GET /api/projects/ai/roadmap`, `GET /api/roadmap`. Screen: header link Roadmap; reorder by dragging or Move up/down (AI-324) (AI-396: the row follows the pointer).
