# Jules — runbook (Andy)

Gives the control plane a Jules API key (AI-233: M9.9: Jules API key secret; epic AI-225: M9: Add Jules + model routing). Until the Jules adapter lands (M9.10), no code reads the key: these steps only put it in place.

| Term            | Meaning                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Jules           | Google's coding agent (jules.google.com): it works in its own VM and opens PRs through its GitHub app                                            |
| `jules-api-key` | Secret Manager secret in `andy-intelligence-512400` holding the Jules API key. Terraform makes the empty container; you add the value            |
| `jules_enabled` | Terraform variable (bool, default `false`): sets `JULES_API_KEY` on the Cloud Run service from the secret. Turn on only after the version exists |
| Root            | `infra/control-plane`, the only root this touches                                                                                                |

The key never goes in the repo, Terraform state, a file or shell history (ADR-0015).

## 1. Apply the secret container

After the AI-233 PR merges, with `jules_enabled` unset (false):

```sh
cd infra/control-plane
terraform plan -out=jules.tfplan
```

Expect **2 to add** (`google_secret_manager_secret.jules_api_key`, `google_secret_manager_secret_iam_member.runtime_reads_jules_api_key`), 0 to change, 0 to destroy. Any other line is drift from elsewhere: read it before applying.

```sh
terraform apply jules.tfplan
```

## 2. Jules account, GitHub app, key

1. Sign in at jules.google.com with the Google account whose plan the control plane should use (its daily task limit is what M9 counts against).
2. Connect GitHub when Jules asks, and install the Jules GitHub app on **only** the repos it may work in (start with `albernhagen/andy-intelligence`). Jules can push branches and open PRs only where the app is installed.
3. **Settings → API keys → Create**. Copy the key; it is shown once.

## 3. Add the key

From the clipboard straight to Secret Manager:

```sh
pbpaste | gcloud secrets versions add jules-api-key --data-file=- --project=andy-intelligence-512400
pbcopy < /dev/null   # clear the clipboard
```

## 4. Turn it on, apply again

1. In `infra/control-plane/terraform.tfvars` (gitignored) set `jules_enabled = true` (see `terraform.tfvars.example`).
2. Add the repository **variable** (not a secret; a bool is public) `TF_VAR_JULES_ENABLED` = `true` (Settings → Secrets and variables → Actions → Variables), so CI's `terraform plan` matches.
3. Plan and apply:

```sh
terraform plan -out=jules.tfplan   # expect 0 to add, 1 to change (google_cloud_run_v2_service.control_plane: env JULES_API_KEY), 0 to destroy
terraform apply jules.tfplan
```

The new revision reads the key at start: if the secret has no version, the revision fails to deploy, so do step 3 first.

## Turn it off or rotate

| Case       | How                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Off        | `jules_enabled = false` in tfvars and the Actions variable, then apply: 1 to change; the next revision has no key                                                                                   |
| Rotate     | Create a new key (step 2.3), step 3 again, then redeploy (`terraform apply` with any change, or a new deploy) so a revision reads it; delete the old key in Jules                                   |
| Leaked key | Delete it in Jules → Settings → API keys at once, then rotate as above and disable the old version: `gcloud secrets versions disable <n> --secret=jules-api-key --project=andy-intelligence-512400` |
