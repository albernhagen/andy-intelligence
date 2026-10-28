# Billing guardrails — runbook (Andy)

GCP cost guardrails for the control plane (ADR-0028: GCP cost guardrails, ADR-0029: Billing root plans locally; kill switch split out). Terraform root: `infra/billing`.

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
cp terraform.tfvars.example terraform.tfvars   # gitignored; paste the ID without the billingAccounts/ prefix
terraform init
terraform providers lock -platform=darwin_arm64 -platform=linux_amd64   # commit .terraform.lock.hcl
terraform plan -out=billing.tfplan             # review in full
terraform apply billing.tfplan
```

Check: [Billing → Budgets & alerts](https://console.cloud.google.com/billing/budgets) shows the budget with thresholds 50%, 90%, 100% (actual) and 100% (forecasted).

## 2. Test that an alert reaches your email

Google has no "send test alert". Lower the budget below this month's spend, wait, then restore it.

1. Billing → Reports, filter to `andy-intelligence-512400`, this month. Note the cost. **If it's $0.00, no alert can fire** — wait until there's some spend.
2. `terraform apply -var budget_amount_usd=0.01` (review the plan: one in-place update of `amount`).
3. Wait up to a day (usually a few hours). Expect emails from `CloudPlatform-noreply@google.com` for the crossed thresholds.
4. `terraform apply` (back to $25). Plan must show only the `amount` change.

## 3. Change the budget

Set `budget_amount_usd` in `terraform.tfvars` (or change the default in `variables.tf` and open a PR), then plan and apply. Thresholds are percentages, so they scale with it.

## 4. Kill switch

**Not built; off.** Design (ADR-0028): at 150% of budget, the budget publishes to Pub/Sub, a small function scales Cloud Run to zero, pauses Cloud Tasks and flags Needs-you. It never disables billing. It lands in slice M1.14: Cost kill switch as an opt-in variable that defaults to off (Needs-you item added after M1.2: Ticket core). Minute-level usage alerts land in M1.15: Usage alerts.

Until then, if spend runs away: `gcloud run services update control-plane --region us-central1 --ingress internal` stops public traffic (then `terraform plan` in `infra/control-plane` shows the drift; apply to restore).

## Other caps (in `infra/control-plane`, CI-planned)

| Cap                                | Value                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Cloud Run max instances            | 2                                                                       |
| Cloud Run request timeout          | 60s                                                                     |
| Cloud Run concurrency per instance | 80                                                                      |
| Log retention                      | `_Default` bucket, 30 days (Google default)                             |
| Log exclusion                      | Successful request logs for `/assets/*` and `/health`                   |
| Artifact Registry                  | Keep 10 most recent; delete images older than 30 days                   |
| Cloud Tasks                        | Queue max rate/concurrency set when the queue lands (M1.2: Ticket core) |
