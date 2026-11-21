# Spend caps

Each project's own caps on paid-model spend (daily, monthly, per task), shown beside the global caps (defaults until AI-276) with what the project and all projects spent today and this month. A project cap can only be lower than the global one; each change is in the settings change log and revertable. Nothing spends yet: the caps are read by the spend gate (AI-248) once paid models land (AI-249).

**How to use:** project settings → Spend caps; MCP `get_spend`, `set_spend_caps`; `GET /api/projects/{id}/spend`, `PUT /api/projects/{id}/spend-caps`
