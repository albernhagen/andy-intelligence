# Project settings

Four sections (Automation, Limits, Defaults, Notifications; AI-339), each switch explained and saved on change with a "Saved" cue; Builds only here (ADR-0063); merge mode loosened only here (ADR-0124, the gate merges by it; not set: nothing merges); changes logged; setup checklist (AI-95; unreadable repo: "unknown") until done, folded to one line after the first visit, also over MCP `project_setup` (AI-287)

**How to use:** Settings menu (gear) → "Project settings" (`/p/<project>/settings`; `/projects` opens it); MCP `get_project_settings` and `project_setup` read, `set_*` change all but Builds (`set_merge_mode` only tightens; Questions per day: `set_daily_question_cap`)
