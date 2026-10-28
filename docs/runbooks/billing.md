# Billing guardrails — runbook (Andy)

GCP cost guardrails for the control plane (ADR-0028: GCP cost guardrails, ADR-0029: Billing root plans locally; kill switch split out). Budget: Terraform root `infra/billing` (sections 1–3). Usage alerts and caps: `infra/control-plane` (sections 5–6).

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

Check: [Billing → Budgets & alerts](https://console.cloud.google.com/billing/budgets) shows the budget with thresholds 50%, 90%, 100% (actual) and 100% (forecasted).

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

**Not built; off.** Design (ADR-0028): at 150% of budget, the budget publishes to Pub/Sub, a small function scales Cloud Run to zero, pauses Cloud Tasks and flags Needs-you. It never disables billing. It lands in slice M1.14: Cost kill switch as an opt-in variable that defaults to off (Needs-you item added after M1.2: Ticket core).
Until then, if spend runs away: `gcloud run services update control-plane --region us-central1 --ingress internal` stops public traffic (then `terraform plan` in `infra/control-plane` shows the drift; apply to restore).

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
