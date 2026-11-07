---
status: accepted
date: 2026-11-06
amends: 0059 (direction: Shortcut's simplicity as the starting point, not its look)
---

# 0070 — UX direction: Shortcut's simplicity as the starting point, our own design on top

Decided by Andy, 2026-11-06.

## Context and Problem Statement

ADR-0058: Ticket model and ADR-0059: UX foundation took Shortcut as the model: story types, markdown stories, simple swim lanes, an easy page. After the first three UI tickets landed (AI-28: Board v2, AI-29: Story panel, AI-30: Inbox v2), Andy wrote: "love the shortcut vibes and UX, but we should make it different enough. I don't want to be an exact clone of that product. I want more improved modern and minimalist design with very efficient UX biased towards our actual use cases."

Our use is not a team's: Andy answers, approves and watches agents work far more than he writes and grooms stories.

## Decision Outcome

| Topic         | Decision                                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What stays    | ADR-0058 and ADR-0059 as built: the ticket model, swim lanes by stage, the story as a panel, the inbox, order as priority. Shortcut's simplicity remains the reference for how much to build.                                             |
| What changes  | The look and the emphasis are our own: modern, minimalist, biased toward deciding (answer, approve, start, watch) rather than operating. No layout is copied for its own sake; each screen earns its parts.                               |
| Where it goes | `apps/web/design.md` (the design source every UI ticket reads) and `docs/product/brief.md`. The command palette ticket (M3: New UI and MCP) and the design-skill trial and dashboards (M4: Epics + story board) carry it in their briefs. |
| Grouping      | A board with a hundred Backlog cards is not usable (Andy, 2026-11-06). AI-39: Refine as the gate into the queue takes volume out of the lanes (Ideas never show as cards); grouping by epic is M4's scope.                                |

### Consequences

- Good: a clear brief for every later UI ticket; the trial of a design skill in M4 has a direction to judge against.
- Bad: "different enough" is a judgment Andy makes on screenshots in each PR; no rule decides it for him.
