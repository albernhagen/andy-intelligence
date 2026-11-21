# 2026-11-21 — AI-302: M4.33: Milestone entity and store

First build ticket of ADR-0131: Milestones. Storage and rules only; nothing reads a milestone yet.

- `Milestone` (`packages/contracts/src/entities/milestone.ts`): project, name (≤ 120), outcome (≤ 300), order, status (`not_reviewed` by default, `approved`, `parked`). Done is computed later, never stored.
- `MilestoneStore` port with `list` (roadmap order: order, then name), `get`, `create` and `replace`; an in-memory fake and a shared contract suite; Firestore adapter at `projects/{p}/milestones/{m}`, server-only. `create` checks the id and the cap (50 per project, ADR-0028) in one transaction, so two creates can't pass it. `list` reads at most 50 documents (ADR-0126).
- `Ticket.milestoneId` (null by default, so older documents read as before). Rules in `packages/domain/src/milestones.ts`: `milestoneOf` reads the top-level epic's milestone for it, its child epics and their tickets; `milestoneTargetProblem` refuses a child epic or a non-epic ticket. No route, tool or UI sets it yet: AI-304: M4.34 adds the service, API and MCP and calls the rule.
