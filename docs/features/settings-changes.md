# Settings changes and revert

Every project-settings write is logged with who, when, before and after, and reason. Andy can revert one: the settings go back through the normal write (logged too) and the original is marked reverted. Refused when a field changed since, naming the newer change; over MCP, never for a Builds switch (ADR-0063). Project routing saves are listed and revert here too (AI-275); global routing changes are on Settings → Models.

**How to use:** Project settings (`/p/<project>/settings`) → Changes → Revert; MCP `list_settings_changes`, `revert_settings_change`
