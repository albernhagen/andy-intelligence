# Milestone page

Each milestone has its own page and URL, `/p/<project>/m/<milestone id>` (milestones have no readable key, so the id; AI-405). It shows the name, outcome, status pick (Not reviewed, Approved, Parked), progress and open-ticket counts, the case and effort, then every epic in the milestone: Done ones included, child epics nested, each with state, progress and a link to its panel. From the page Andy can:

- reorder epics (drag, or Move up and Move down): the epic's place among this milestone's epics, the roadmap's order;
- move an epic to another milestone, or to none;
- open Draft tickets, the epic panel's breakdown (AI-383);
- add a **New epic**, created already in this milestone;
- see what waits on him here: questions, flagged tickets, PRs waiting for his merge and drafted tickets, each linking to its ticket.

An unknown id, or another project's, shows "Page not found."

**How to use:** open a milestone from its roadmap row (the arrow beside it), the milestone chip on an epic's panel or the board's epic groups, or the arrow on a milestone group in Ideas. Over MCP: `roadmap` reads it; `set_milestone_status`, `edit_milestone`; New epic is `create_ticket` (type `epic`) then `set_epic_milestone`; `reorder_ticket` moves a top-level epic among its milestone's epics, whatever their stages.
