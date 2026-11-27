# Prod alerts

AI-209: M6.19, ADR-0114. A `cloud-run` project's prod service gets two Cloud Monitoring alerts, emailed to the environment's `alert_email`:

| Alert         | Fires when                                                             |
| ------------- | ---------------------------------------------------------------------- |
| `Prod down`   | `/health` fails from 2 of 3 US regions for 5 minutes (checked every 5) |
| `Prod errors` | More than 5 5xx responses in 5 minutes                                 |

Dev environments don't get them (`prod_alerts_enabled = false` in the `dev-and-prod` root). A service behind Cloud Run IAM gets only `Prod errors`. Cost: about $0.20/month per prod service. Not built: alert → ticket, error budgets.

**How to use:** apply the project's `infra/` root (runbook [`project-env.md`](../runbooks/project-env.md) "Prod alerts"); the app must answer `/health` with 2xx.

**Code:** `infra/modules/project-alerts`, called from `infra/modules/project-env/observability.tf`.
