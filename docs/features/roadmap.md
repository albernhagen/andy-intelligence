# Roadmap data

A project's top-level epics from its tickets in rank order (Done ones too), each with its outcome, Done-when lines, state (not started, in progress, done), progress and counts of open tickets (needs you, in review, in progress, blocked, not started). Child epics nest one level and count toward their parent. Computed on read from each project's board through the read cache; never stored (AI-193, ADR-0108). The screen comes with M4.26.

**Milestones** (ADR-0131, AI-304): a project's ordered groups of top-level epics, each not reviewed, approved or parked. Andy creates, renames, reorders and sets their status, and attaches an epic (its child epics and tickets take its milestone); each change is in the project's change log and can be reverted there. Web and MCP do the same; milestones aren't deleted (park one).

**How to use:** milestones: MCP `list_milestones`, `create_milestone`, `edit_milestone`, `set_milestone_status`, `set_epic_milestone`, or `GET`/`POST /api/projects/ai/milestones`, `PATCH …/milestones/:id`, `PUT …/tickets/:id/milestone`. Roadmap: MCP `roadmap`, optional `project`; `GET /api/projects/ai/roadmap`, or `GET /api/roadmap` for every project you can read (first 50 by key).
