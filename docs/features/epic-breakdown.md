# Epic breakdown

An agent drafts one top-level epic's child tickets in an approved milestone: title, type, size, acceptance criteria, touches, blockers. The draft is a proposal Andy approves or sends back with a note. Approved, the tickets land under the epic in Ideas, with blockers linked by key, and nothing builds. Up to 12 tickets per draft and 3 drafting tasks per epic (ADR-0155).

**How to use:** MCP `start_epic_breakdown` (`ticket`: the epic's key) starts the agent task. `list_needs_me` lists waiting drafts as `epicBreakdowns`, decided with `approve_epic_breakdown` or `reject_epic_breakdown` (`reason`). A Claude session can draft by hand with `platform/procedures/plan-epic.md`, then `submit_epic_breakdown`. REST: `POST /api/projects/<id>/tickets/<ticketId>/breakdown/agent-task`, `…/breakdown`, `…/breakdown/decision`, `GET /api/epic-breakdowns/waiting`. The epic panel and inbox section come in a follow-up PR.
