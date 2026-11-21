# Roadmap data

A project's milestones from its tickets: top-level epics in rank order (Done ones too), each with its outcome, Done-when lines, state (not started, in progress, done), progress and counts of open stories (needs you, in review, in progress, blocked, not started). Child epics nest one level and count toward their parent. Computed on read from each project's board through the read cache; never stored (AI-193, ADR-0108). The screen comes with M4.26.

**How to use:** MCP `roadmap`, optional `project`; `GET /api/projects/ai/roadmap`, or `GET /api/roadmap` for every project you can read (first 50 by key).
