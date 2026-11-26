# 2026-11-26: AI-209: M6.19: Prod uptime and error alerts

- Andy approved the plan; this closes the pending decision "Production monitoring as part of shipped" for alerts. Error budgets and alert → ticket stay Later.
- New module `infra/modules/project-alerts`, called by `project-env` (`prod_alerts_enabled`, default on; the `dev-and-prod` root turns it off for dev), so no template root has to wire it.
- Deviation from the ticket body: it said email the billing admins "like budgets do". Monitoring alerts can't; they need a notification channel, so they reuse `project-env`'s `alert_email` channel (a variable, never in the repo).
- Cost: ~$0.20/month per prod service (2 conditions at $0.10). Uptime check fixed at 5 min × 3 regions (~26k runs a month, 1M free).
- Andy applies: each `cloud-run` project's `infra/` root, +3 adds for prod (runbook `project-env.md`). No project is live yet.
