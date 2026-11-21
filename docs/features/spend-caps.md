# Spend caps

Each project's own caps on paid-model spend (daily, monthly, per task), shown beside the global caps (the ceiling; set by Andy on Settings → Models, the code defaults until then, AI-276) with what the project and all projects spent today and this month. A project cap can only be lower than the global one; each change, project or global, is in a change log and revertable. Nothing spends yet: the caps are read by the spend gate (AI-248) once paid models land (AI-249).

**How to use:** project settings → Spend caps; Settings → Models → Spend caps (global); MCP `get_spend`, `set_spend_caps`, `set_global_spend_caps`, `list_spend_cap_changes`, `revert_spend_cap_change`; `GET /api/projects/{id}/spend`, `PUT /api/projects/{id}/spend-caps`
