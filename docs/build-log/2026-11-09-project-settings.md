# 2026-11-09 — AI-46: Project settings

- Built `/p/<project>/settings`: every per-project switch (Builds, Auto-build, Plan approval, Auto-refine, Questions per day, Auto-merge, Runs at once, Paused, Default worker) with one line on what each does. The controls moved from `/projects` unchanged; they save through `PATCH /api/projects/{id}` with the same rules.
- The header shows "Project settings" while a project is in scope. `/projects` opens the remembered project's settings, else the first project's; with no projects it shows the new-project form. "Add project" in the picker opens `/projects/new`.
- MCP `get_project_settings` (read-only) returns every setting, `buildEnabled` with `buildEnabledBy` / `buildEnabledAt`, and `lastDispatch` (the dispatcher's last decision, ADR-0079). Builds still has no MCP setter (ADR-0063; Andy chose option 1 on the ticket).
- "Builds disabled for a non-owner": today every signed-in user is Andy (allow-list), so the UI has no non-owner state to disable; the owner-only rule is that Builds is set only from the app, never over MCP. Multi-user roles are out of scope.
- No `SCHEMA_VERSION` bump (no new fields); no `terraform apply`.
