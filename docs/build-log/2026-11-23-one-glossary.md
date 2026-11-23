# 2026-11-23 — AI-205: M4.27: One glossary; slice tables retired

Andy, 2026-11-21: use only the system's terms. Project, milestone, epic, ticket; no "slice", no "story".

- **Glossary:** `docs/architecture/glossary.md` (project, milestone, epic, ticket, the five ticket types); ARCHITECTURE's reading map links it.
- **Wording:** docs, agent rules, procedures and UI text say milestone, epic or ticket. Milestone M4 and its epic AI-84 are renamed "M4: Epics + ticket board".
- **Tables deleted:** `m4`, `m5`, `m6`, `m8`, `m9` and `m10-slices.md`. Every row was checked against its ticket; missing Done-when went in as acceptance criteria (AI-162, AI-183, AI-199, AI-267, AI-205), and table-level notes (already built, batch order, critical path) went into the milestone epics (AI-84, AI-82, AI-153, AI-18, AI-225, AI-226). No size differed. Each milestone's tickets: the roadmap and MCP `milestone_map`.
- **Open tickets reworded** over MCP (about 60); Done and cancelled tickets left as written.
- **Kept on purpose:** the `slices` field of project plans and ideation (an API field), `history/m1-merged-slices.md` (history links point at it), the v1 ticket type `story` in the v2 upgrader note, code identifiers such as `NightStatus.stories`, and ADR bodies.
- **Deleted tables stay readable** in git: `git show 104a5182:docs/architecture/m4-slices.md` (also `m5`, `m6`, `m8`, `m9`, `m10`). ADR-0108 and older build-log entries name them as text; that is history, left as written.
- **Risk column carried over** (Andy, 2026-11-23) onto the 33 open tickets with a row, reason "From the retired M<N> table"; Done and cancelled tickets left empty. The tables said:
  - M4: high AI-87, AI-103, AI-121, AI-122, AI-124, AI-127, AI-186, AI-197, AI-205; low AI-126, AI-129; AI-208 high if built; AI-128 "Andy merges"; the rest medium.
  - M5: high AI-83, AI-92, AI-93, AI-94, AI-97, AI-98, AI-99, AI-105, AI-106, AI-107, AI-109, AI-110, AI-111, AI-112, AI-113; the rest medium.
  - M6: medium AI-160, AI-161, AI-169, AI-170, AI-183, AI-189, AI-200; the rest high.
  - M8: medium AI-251, AI-262, AI-264, AI-265, AI-270; low AI-272; the rest high. M9 and M10 had a "who merges" column, not risk.
- **Branch pattern** is now `m<N>.<n>/<short-name>` (Andy, 2026-11-23); no script, hook or workflow enforced the old one.
