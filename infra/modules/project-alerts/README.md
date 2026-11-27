# Module `project-alerts`

Prod uptime and error alerts for a `cloud-run` project (AI-209: M6.19, ADR-0114). `project-env` calls it for prod (`prod_alerts_enabled`); nothing here names a project, host or address: all are variables. Andy applies ([runbook](../../../docs/runbooks/project-env.md) "Prod alerts").

| Resource                         | Detail                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Uptime check `<service> /health` | HTTPS GET on `service_host` + `health_path`, expects 2xx; every 5 min from 3 US regions, 10s timeout (fixed: cost cap) |
| Alert `Prod down`                | The check fails from 2 or more regions for 5 minutes. Skipped with the check when `uptime_check_enabled` is off        |
| Alert `Prod errors`              | More than `error_threshold_per_5m` (5, at most 1000) 5xx responses from `service_name` in 5 minutes                    |

Both go to `notification_channel_ids` and auto-close after 24h. Cost: about $0.20/month (2 alert conditions at $0.10); the check's ~26k runs a month are inside the 1M free per project. Later: alert → ticket, error budgets.

## Tests

Plan-only, mocked provider, no credentials; `platform/actions/terraform-check` runs them in CI:

```bash
terraform -chdir=infra/modules/project-alerts init -backend=false && terraform -chdir=infra/modules/project-alerts test
```
