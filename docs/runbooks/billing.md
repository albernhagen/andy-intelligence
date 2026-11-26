# Billing guardrails — runbook (Andy)

GCP cost guardrails for the control plane (ADR-0028: GCP cost guardrails, ADR-0029: Billing root plans locally; kill switch split out). Budget and kill switch: Terraform root `infra/billing` (sections 1–4). Usage alerts and caps: `infra/control-plane` (sections 5–6). The config-change alert shares the usage alerts' email (section 7). Managed projects' budgets: section 8.

| Term               | Meaning                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| Billing account ID | `XXXXXX-XXXXXX-XXXXXX`, the account that pays for `andy-intelligence-512400`. Kept out of the public repo. |
| Budget             | Cloud Billing budget `andy-intelligence-512400 monthly`: $25/month, this project only, net of credits.     |
| Alert recipients   | The billing account's Billing Account Administrators and Users (Google's default). No addresses in config. |

## Why plans are local only

CI's read-only `tf-plan` identity has no billing-account access, so CI only runs `terraform fmt`/`validate` on `infra/billing`. Plan and apply from your machine. No Actions secret is needed.

## 1. First apply

You need Billing Account Administrator (or Costs Manager) on the billing account.

```sh
gcloud billing projects describe andy-intelligence-512400 --format='value(billingAccountName)'   # billingAccounts/<ID>
gcloud billing accounts get-iam-policy <ID> --format=json | grep -A3 billing.admin           # your Gmail should be listed

cd infra/billing
cp terraform.tfvars.example terraform.tfvars   # gitignored; replace the placeholder with the ID (no billingAccounts/ prefix)
terraform init
terraform plan -out=billing.tfplan             # review in full
terraform apply billing.tfplan
```

Check: [Billing → Budgets & alerts](https://console.cloud.google.com/billing/budgets) shows the budget with thresholds 50%, 90%, 100%, 150% (actual) and 100% (forecasted).

## 2. Check that alerts will reach you

Google has no "send test alert", so check the two things a test would prove:

1. **You're a default recipient:** `gcloud billing accounts get-iam-policy <ID>` lists your Gmail under `roles/billing.admin` (or `roles/billing.user`). Or Console → Billing → Account management → Permissions.
2. **Google Cloud mail reaches your inbox:** Gmail shows recent mail from `cloudplatform-noreply@google.com`, not in spam.

Optional end-to-end test (only works if this month's cost for the project is above $0.00):

1. `terraform apply -var budget_amount_usd=0.01` (plan: one in-place update of `amount`).
2. Wait a few hours (up to a day) for the threshold emails.
3. `terraform apply` (back to $25; plan shows only the `amount` change).

## 3. Change the budget

Set `budget_amount_usd` in `terraform.tfvars` (or change the default in `variables.tf` and open a PR), then plan and apply. Thresholds are percentages, so they scale with it.

## 4. Kill switch

Opt-in (ADR-0028, ADR-0036: Kill switch runs on Cloud Workflows). When actual spend reaches 150% of the budget, a workflow sets the `control-plane` Cloud Run service to manual scaling at 0 instances (requests fail as "Service unavailable") and pauses every Cloud Tasks queue in `us-central1`. It never disables billing. You also get the 150% budget email.

| Piece                                                                                             | Name                      |
| ------------------------------------------------------------------------------------------------- | ------------------------- |
| Pub/Sub topic the budget publishes to (several times a day)                                       | `budget-notifications`    |
| Eventarc trigger → workflow                                                                       | `cost-kill-switch` (both) |
| Identity (Cloud Run get/update on `control-plane` only; Cloud Tasks list/pause; actAs runtime SA) | `cost-kill-switch@…`      |

Cost: about $0 (Pub/Sub free tier; Workflows' 5,000 free steps a month, about $0.01 per 1,000 beyond).

### Turn on

1. Add `kill_switch_enabled = true` to `infra/billing/terraform.tfvars`.
2. `terraform plan -out=billing.tfplan` → expect about 15 to add (3 APIs, topic + publisher grant, SA, 2 custom roles, 1 service grant, 3 project grants, actAs grant, workflow, trigger) and 1 in-place change to the budget (`all_updates_rule`, 150% threshold). Then `terraform apply billing.tfplan`. (Applied the switch before the role was narrowed (2026-11-01)? Expect 2 to add, 1 to change: the Cloud Run role moves onto the service.)

### Test (free; takes the service offline briefly)

Publish a fake budget message at 200% of budget:

```sh
gcloud pubsub topics publish budget-notifications --project andy-intelligence-512400 \
  --message '{"budgetDisplayName":"test","costAmount":50,"budgetAmount":25,"currencyCode":"USD"}'
```

Within a minute or two:

- [ ] `curl -s -o /dev/null -w '%{http_code}\n' https://control-plane-662512537397.us-central1.run.app/health` is no longer 200.
- [ ] `gcloud tasks queues describe run-watchdog --location us-central1 --format='value(state)'` → `PAUSED`.
- [ ] Workflows console → `cost-kill-switch` → latest execution succeeded with "tripped".

A message under the limit (e.g. `"costAmount":10`) should leave everything up; the execution returns "under limit".

### Re-enable

```sh
gcloud run services update control-plane --region us-central1 --scaling auto
gcloud tasks queues resume run-watchdog --location us-central1
curl -s https://control-plane-662512537397.us-central1.run.app/health   # {"status":"ok",…}
```

For about a minute after `--scaling auto`, requests can return 500 ("try again in 30 seconds") while the service starts; it then returns 200 (seen in the 2026-11-01 demo).

If spend is still over 150%, the next budget message trips the switch again. Raise the budget, set `kill_switch_enabled = false`, or fix the cause first.

### Turn off

Set `kill_switch_enabled = false` (or remove the line), plan and apply: everything above is removed and the budget stops publishing.

Manual stop (any time, without the switch): `gcloud run services update control-plane --region us-central1 --ingress internal` blocks public traffic; undo with `--ingress all` (or `terraform apply` in `infra/control-plane`).

## 5. Usage alerts

Cloud Monitoring emails `alert_email` within minutes when usage spikes. Budgets lag by hours, and nothing in GCP caps egress, Firestore ops or log volume. Alerting is free until at least September 2027, then about $2/month for these six alerts.

**Setup (once):**

1. Add `alert_email = "you@example.com"` to `infra/control-plane/terraform.tfvars` (gitignored).
2. GitHub → Settings → Secrets and variables → Actions → **New repository secret** `TF_VAR_ALERT_EMAIL`, value the same address without quotes. CI plans fail without it.
3. `terraform plan -out=cp.tfplan`, review, `terraform apply cp.tfplan`.

| Alert (Monitoring → Alerting)     | Fires when                         | Variable key                |
| --------------------------------- | ---------------------------------- | --------------------------- |
| Usage: Cloud Run requests spike   | > 3,000 requests in 5 minutes      | `run_requests_per_5m`       |
| Usage: Cloud Run bytes sent spike | > 1 GiB sent in 1 hour             | `run_sent_bytes_per_hour`   |
| Usage: Firestore reads spike      | > 20,000 document reads in 1 hour  | `firestore_reads_per_hour`  |
| Usage: Firestore writes spike     | > 10,000 document writes in 1 hour | `firestore_writes_per_hour` |
| Usage: Firestore deletes spike    | > 10,000 deletes in 1 hour         | `firestore_writes_per_hour` |
| Usage: Log ingestion spike        | > 500 MiB ingested in 1 hour       | `log_bytes_per_hour`        |

Windows are rolling; an alert auto-closes a day after usage drops. To tune, set `usage_alert_thresholds = { run_requests_per_5m = 5000 }` in `terraform.tfvars` (other keys keep defaults), or change the defaults in `variables.tf` by PR.

**When one fires:** find the cause in Cloud Run metrics, Firestore usage, or Logs Explorer. If it's abuse or a runaway loop, use the emergency stop in section 4.

**Firestore reads (AI-315):** every request and every dispatch event logs the documents it read. In Logs Explorer, query `jsonPayload.component="read-meter"` over the alert's hour, then add up `jsonPayload.reads` by `jsonPayload.route` (and `jsonPayload.tool` for MCP calls on `/mcp`); `message="dispatch reads"` lines are dispatch events (their reads also count in the request that caused them). The biggest total is the cause.

**Test (a few minutes):** `terraform apply -var 'usage_alert_thresholds={run_requests_per_5m=0}'`, open the app (any request), wait for the email, then `terraform apply` to restore.

## 6. Other caps (in `infra/control-plane`, CI-planned)

| Cap                                | Value                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Cloud Run max instances            | 2                                                                       |
| Cloud Run request timeout          | 60s                                                                     |
| Cloud Run concurrency per instance | 80                                                                      |
| Log retention                      | `_Default` bucket, 30 days (Google default)                             |
| Log exclusion                      | Successful request logs for `/assets/*` and `/health`                   |
| Artifact Registry                  | Keep 10 most recent; delete images older than 30 days                   |
| Cloud Tasks                        | Queue max rate/concurrency set when the queue lands (M1.2: Ticket core) |

## 7. Config change not recorded (AI-136)

A project-settings change succeeds even when its change-log entry fails to write; the API then logs the ERROR `config change not recorded` (`component: "projects"`). A log-based metric counts those lines and the alert **Config change not recorded in the change log** emails `alert_email` (section 5): one email per 5-minute window with failures; it closes once a window is quiet.

**Apply (once):** in `infra/control-plane`, `terraform plan -out=cp.tfplan`. Expect **2 to add, 0 to change, 0 to destroy**: `google_logging_metric.config_change_not_recorded` and `google_monitoring_alert_policy.config_change_not_recorded`. Anything else in the plan is drift from another change: stop and check. Then `terraform apply cp.tfplan`. Cost: one more alert condition; the metric's volume is a few points a month.

**When it fires:** Logs Explorer, query `jsonPayload.message="config change not recorded"`. Each entry has `projectId`, `diff` (before and after per field), `by` and `error`. The settings change itself went through; only its log entry is missing. Fix the cause (usually Firestore errors or quota), and note the change by hand if its audit trail matters.

**Don't reword the message.** The metric's filter matches `CONFIG_CHANGE_NOT_RECORDED` in `packages/domain/src/config-changes.ts`; `config-changes.test.ts` fails if the two differ.

## 8. Managed project budgets (AI-162: M6.14: Project budget module)

Each managed project environment (one GCP project) gets a budget from `infra/modules/project-budget`, called by `infra/billing` once per entry in `managed_projects` (ADR-0114). Same thresholds as the control plane: 50%, 90%, 100%, 150% actual and 100% forecast, to the same default recipients. Defaults: $10/month, kill switch off.

**Add a project:**

1. Add an entry to `managed_projects` in `infra/billing/terraform.tfvars` (shape in `terraform.tfvars.example`): `"<project>-dev" = { project_id = "<gcp-project-id>" }`. The project must be on the same billing account.
2. `terraform plan -out=billing.tfplan`. Expect **1 to add, 0 to change, 0 to destroy** per new entry: `module.managed_project_budget["<key>"].google_billing_budget.this`. Anything else is drift: stop and check.
3. `terraform apply billing.tfplan`. Check: Billing → Budgets & alerts shows `<gcp-project-id> monthly`.

**Turn its kill switch on:** set `kill_switch_enabled = true`, `kill_switch_service = "<cloud-run-service>"` and `kill_switch_runtime_sa = "<runtime-sa-email>"` on that entry (the service and identity must exist). Plan: **15 to add, 1 to change** (3 APIs, topic + publisher grant, SA, 2 custom roles, 1 service grant, 3 project grants, actAs grant, workflow, trigger; the budget gains `all_updates_rule`). Test, re-enable and turn off as in section 4, with that project's ID, region and service. Custom roles are soft-deleted for 7 days after removal: turning the switch off and on again within that window fails until they're purged; wait or undelete them.

**Remove a project:** delete its entry; plan shows 1 to destroy (plus the kill switch resources if it was on).

The first apply after AI-162 merges, with no `managed_projects` entry, should show **No changes**: the kill switch workflow file moved to the module folder with the same content.
