# Cost guardrails

$25/month budget alerts, usage alerts, caps, opt-in kill switch at 150% of budget

Managed projects: each environment's GCP project gets its own budget ($10/month default, same thresholds) and an opt-in kill switch, from `infra/modules/project-budget` via `infra/billing` (AI-162). Andy adds the project and applies.

**How to use:** [`docs/runbooks/billing.md`](../runbooks/billing.md)
