# Milestone status on epics and the board

Each epic shows its milestone and the milestone's status, for example "M6: Dev → prod releases · Parked" (ADR-0131: Milestones; AI-311: M4.38). The chip appears on the epic panel and on the board's epic group headers. A child epic or a ticket shows the milestone of its top-level epic, with "from AI-84". A Ready or Up next ticket that dispatch holds shows "Waiting: Milestone <name> is parked" (or "is not reviewed") in its status line, which is the same rule as MCP `status`. Only the owner can change a status or attach an epic: the API refuses anyone else, and each change goes into the project's change log, where it can be reverted.

**How to use:** open a top-level epic and pick its **Milestone**, then its **Milestone status**. Or open a row on the Roadmap and set its status there. Turn on **Group by epic** on the board to see each group's milestone. Over MCP, use `set_epic_milestone` and `set_milestone_status`.
