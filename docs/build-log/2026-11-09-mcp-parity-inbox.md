# 2026-11-09 — AI-40: Decide from any harness

- Parity rule written into `docs/architecture/api-and-mcp.md` and the adversarial-review checklist.
- Audit: REST and UI already covered edit fields, comment, re-parent and reorder, so no new routes. New MCP tools: `edit_ticket`, `comment_ticket`, `set_ticket_parent`, `reorder_ticket`.
- New rule on REST too: a parent must be an epic in the same project, with no cycle (422 `invalid_reference`).
- Inbox order and status line moved to `@andy/domain`; `GET /api/needs-you` and `list_needs_me` return the inbox's order, `status` returns the UI's status line.
- `/inbox`: `platform/procedures/inbox.md` and `.claude/skills/inbox/SKILL.md`. Claude desktop's chat doesn't read repo skills; devkit packaging (out of scope) covers it.
