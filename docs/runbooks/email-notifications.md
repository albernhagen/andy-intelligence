# Needs-you email — runbook (Andy)

Turns on email for the Needs-you inbox (AI-77: Email notifications for the inbox, ADR-0060). Until every step is done the control plane sends nothing: it logs `email not configured` once at start, and Project settings shows "Email notifications (off: email is not configured)".

| Term             | Meaning                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Resend           | The email provider (resend.com) behind the `Notifier` port's email adapter (`apps/api/src/notifier-email.ts`)                          |
| `resend-api-key` | Secret Manager secret in `andy-intelligence-512400` holding the Resend API key. Terraform makes the empty container; you add the value |
| `email_from`     | Terraform variable: the sender, on the domain you verify in Resend, e.g. `andy-intelligence <notify@your-domain>`                      |
| `email_to`       | Terraform variable: where the emails go                                                                                                |
| Caps             | 20 emails a UTC day, then one "more waiting" email, then none until the next day; items within 10 minutes share one email (ADR-0028)   |

Addresses and the key never go in the repo (it is public, ADR-0015): only in gitignored `terraform.tfvars`, Actions secrets and Secret Manager.

## 1. Resend account

1. Sign up at resend.com.
2. **Domains → Add domain**: a domain or subdomain you control (e.g. `mail.andybernhagen.com`). Add the DNS records Resend shows (SPF, DKIM; MX for bounces) in Cloudflare, then **Verify**. Wait until it shows Verified.
3. **API keys → Create**: permission **Sending access**, domain: the one above. Copy the key (`re_…`); Resend shows it once.

## 2. Apply this PR's Terraform (secret container)

After the AI-77 PR merges, with `email_from` and `email_to` still unset:

```sh
cd infra/control-plane
terraform plan -out=email.tfplan
```

Expect from AI-77: **2 to add** (`google_secret_manager_secret.resend_api_key`, `google_secret_manager_secret_iam_member.runtime_reads_resend_api_key`), 0 to change, 0 to destroy. Any other line is drift from elsewhere (e.g. R26 in the threat model): read it before applying.

```sh
terraform apply email.tfplan
```

## 3. Add the key

The key goes from your clipboard straight to Secret Manager (not in shell history or a file):

```sh
pbpaste | gcloud secrets versions add resend-api-key --data-file=- --project=andy-intelligence-512400
pbcopy < /dev/null   # clear the clipboard
```

## 4. Addresses, then apply again

1. In `infra/control-plane/terraform.tfvars` (gitignored) set `email_from` and `email_to` (see `terraform.tfvars.example`).
2. Add the same two values as repository Actions secrets `TF_VAR_EMAIL_FROM` and `TF_VAR_EMAIL_TO` (Settings → Secrets and variables → Actions), so CI's `terraform plan` matches.
3. Plan and apply:

```sh
terraform plan -out=email.tfplan   # expect 0 to add, 1 to change (google_cloud_run_v2_service.control_plane: env EMAIL_FROM, EMAIL_TO, RESEND_API_KEY), 0 to destroy
terraform apply email.tfplan
```

The new revision reads the key at start. Check the logs: no `email not configured` line after the revision starts.

## 5. Send a test

Project settings (`/p/ai/settings`) → "Email notifications" now shows "(0 of 20 sent today)" → **Send test email**. One email "andy-intelligence: test email" arrives; the count shows 1. It counts toward the day's 20.

If nothing arrives: Cloud Logging, `jsonPayload.component="notify-email"`. `email send failed` carries the provider's error name (e.g. a domain not verified).

## Turn it off

| Scope       | How                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One project | Untick "Email notifications" in its settings, or MCP `set_email_notifications` with `enabled: false`                                                               |
| Everything  | Set `email_from = ""` (or `email_to`) in tfvars and apply: 1 to change; the next revision sends nothing                                                            |
| Leaked key  | Resend → API keys → revoke; create a new one; step 3 again, then redeploy (`terraform apply` with any change, or a new deploy) so a revision reads the new version |
