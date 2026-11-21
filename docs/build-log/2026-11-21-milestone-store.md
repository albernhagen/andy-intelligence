# 2026-11-21 — AI-302: M4.33: Milestone entity and store

First build ticket of ADR-0131: Milestones. Storage and rules only; nothing reads a milestone yet.

- `Milestone` (`packages/contracts/src/entities/milestone.ts`): project, name (≤ 120), outcome (≤ 300), order, status (`not_reviewed` by default, `approved`, `parked`). Done is computed later, never stored.
- `MilestoneStore` port with `list` (roadmap order: order, then name), `get`, `create` and `replace`; an in-memory fake and a shared contract suite; Firestore adapter at `projects/{p}/milestones/{m}`, server-only. `create` checks the id and the cap (50 per project, ADR-0028) in one transaction, so two creates can't pass it. `list` reads at most 50 documents (ADR-0126).
- `Ticket.milestoneId` (null by default, so older documents read as before). `milestoneOf` (`packages/domain/src/milestones.ts`) reads the top-level epic's milestone for it, its child epics and their tickets. `milestoneTargetProblem` (`packages/contracts/src/entities/milestone.ts`) refuses a milestone on a child epic or a non-epic ticket; `applyTicketChange` already calls it on every ticket write, the fake's and Firestore's, so a type or parent change can't leave one behind (a `conflict`). No route, tool or UI sets `milestoneId` yet: AI-304: M4.34 adds that write and must check the milestone exists in the same project.
