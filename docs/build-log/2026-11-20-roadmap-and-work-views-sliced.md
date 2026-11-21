# 2026-11-20 — Roadmap and work views sliced into M4: Epics + story board

- Andy asked for milestones and plans in the UI ("the noise of individual tickets will be too high") and for a way to see tickets that need him, are his or the agents', or are blocked. Decision: ADR-0108: Roadmap view over epics, and fixed work views (proposed).
- Eight tickets under AI-84: M4: Epics + story board, all in Ideas: AI-186: M4.24: Epic outcome field; AI-193: M4.25: Roadmap data API and MCP tool; AI-202: M4.26: Roadmap screen; AI-205: M4.27: Retire the slice tables (assigned to Andy); AI-187: M4.28: Board work filters; AI-198: M4.29: Work across projects; AI-208: M4.30: Agent-written "what changed" paragraph per epic (parked, unsized); AI-197: M4.31: Ideate and refine write an epic's outcome. Rows in `docs/architecture/m4-slices.md`.
- Andy's four answers, with what he turned down:

| Question                                      | Chosen                                                          | Turned down                                                   |
| --------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| Where it lives                                | Slices in M4                                                    | A new milestone (renumbering ADR); an epic outside milestones |
| Where a milestone's summary comes from        | Stored fields and computed status now, an agent paragraph later | Agent-written only, refreshed on every merge                  |
| The hand-kept markdown maps                   | The UI replaces them                                            | Keep both; generate the markdown from tickets                 |
| Seeing what needs Andy, his, agents', blocked | Fixed chips on the board, then a list across projects           | Board chips only; a separate page only                        |

- Changed from the plan Andy approved (seven slices), each for a reason found while writing the tickets:
  - "Done when" is the epic's existing acceptance criteria under that label, not a second list: one new field (`outcome`) instead of two.
  - Agents filling the outcome is its own ticket (M4.31): it changes `platform/procedures/`, which is high risk, and M4.24 stays small.
  - M4.25 builds on AI-148: Milestone map generated from tickets, which another session is building; M4.27 no longer removes the build-log map (AI-148 does) and creates only the milestone epics still missing (M6 has AI-153: M6: Dev → prod releases).
- Budgets: the ADR index and `ui.md` were at their caps, so this PR trims as many words as it adds in each (index header and one stale phrase; the run-detail note in `ui.md` merged into its screen line).
