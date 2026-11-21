# Model scout

Once a week (Mondays 06:00 UTC) the control plane reads OpenRouter's public models list and recent agent-task outcomes, and proposes at most one tier change: a cheaper model with as good a success rate (5+ tasks on both), or a flag when a tier's model is gone. The proposal is a pending config change in the Needs-you inbox; nothing changes until Andy accepts it and edits the tier (AI-268: M10.17; logic AI-237: M10.5). Only tiers whose first route is on OpenRouter are checked, so with today's Claude-only tiers it proposes nothing. Off until its Terraform is applied (runbook `model-scout.md`).

**How to use:** Inbox (pending change, entity `tiers`); MCP `list_config_changes`; run it now: `gcloud scheduler jobs run model-scout-weekly --location <region>`
