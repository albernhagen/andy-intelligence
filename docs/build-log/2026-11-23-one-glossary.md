# 2026-11-23 — AI-205: M4.27: One glossary; slice tables retired

Andy, 2026-11-21: use only the system's terms. Project, milestone, epic, ticket; no "slice", no "story".

- **Glossary:** `docs/architecture/glossary.md` (project, milestone, epic, ticket, the five ticket types); ARCHITECTURE's reading map links it.
- **Wording:** docs, agent rules, procedures and UI text say milestone, epic or ticket. Milestone M4 and its epic AI-84 are renamed "M4: Epics + ticket board".
- **Tables deleted:** `m4`, `m5`, `m6`, `m8`, `m9` and `m10-slices.md`. Every row was checked against its ticket; missing Done-when went in as acceptance criteria (AI-162, AI-183, AI-199, AI-267, AI-205), and table-level notes (already built, batch order, critical path) went into the milestone epics (AI-84, AI-82, AI-153, AI-18, AI-225, AI-226). No size differed. Each milestone's tickets: the roadmap and MCP `milestone_map`.
- **Open tickets reworded** over MCP (about 60); Done and cancelled tickets left as written.
- **Kept on purpose:** the branch pattern `m<N>.<slice>/<short-name>` (question for Andy), the `slices` field of project plans and ideation (an API field), `history/m1-merged-slices.md` (history links point at it), the v1 ticket type `story` in the v2 upgrader note, code identifiers such as `NightStatus.stories`, and ADR bodies.
- **Not carried over:** the tables' risk column (every ticket's `risk` is empty; the values are listed in the AI-205 PR for Andy to decide).
