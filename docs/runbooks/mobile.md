# Mobile: Web Push keys — runbook (Andy)

Gives the control plane its Web Push key pair (AI-179: M7.10: VAPID key secret, ADR-0052, ADR-0115 Q2). Until every step is done the API sends no push. The sender that reads these keys is AI-178: M7.9: web-push sender (PR #245); once it is on `main`, the API logs `push not configured` once at start while the keys are missing.

| Term                | Meaning                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| VAPID key pair      | One P-256 key pair. The private key signs every push request; the public key goes to the browser when a device subscribes            |
| `vapid-private-key` | Secret Manager secret in `andy-intelligence-512400` holding the private key. Terraform makes the empty container; you add the value  |
| `vapid_public_key`  | Terraform variable: the public key (87 characters, base64url). Public, not a secret                                                  |
| `push_enabled`      | Terraform variable (bool, default `false`): sets `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` on the service. Needs `vapid_public_key` |
| Root                | `infra/control-plane`, the only root this touches                                                                                    |

The private key never goes in the repo, Terraform state, a file or shell history (ADR-0015).

## 1. Apply the secret container

After the AI-179 PR merges, with `push_enabled` unset (false):

```sh
cd infra/control-plane
terraform plan -out=push.tfplan
```

Expect **2 to add** (`google_secret_manager_secret.vapid_private_key`, `google_secret_manager_secret_iam_member.runtime_reads_vapid_private_key`), 0 to change, 0 to destroy. Any other line is drift from elsewhere: read it before applying.

```sh
terraform apply push.tfplan
```

## 2. Make the key pair and add the private key

On your Mac. The pair lives only in shell variables; the private key goes straight to Secret Manager:

```sh
KEYS=$(npx -y web-push@3.6.7 generate-vapid-keys --json)
printf %s "$KEYS" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).privateKey)' \
  | gcloud secrets versions add vapid-private-key --data-file=- --project=andy-intelligence-512400
printf %s "$KEYS" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0)).publicKey)'   # copy this: the public key
unset KEYS
```

## 3. Public key, then apply again

1. In `infra/control-plane/terraform.tfvars` (gitignored) set `push_enabled = true` and `vapid_public_key = "<public key>"` (see `terraform.tfvars.example`).
2. Add repository **variables** (not secrets; both values are public) `TF_VAR_PUSH_ENABLED` (`true`) and `TF_VAR_VAPID_PUBLIC_KEY` (Settings → Secrets and variables → Actions → Variables), so CI's `terraform plan` matches.
3. Plan and apply:

```sh
terraform plan -out=push.tfplan   # expect 0 to add, 1 to change (google_cloud_run_v2_service.control_plane: env VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY), 0 to destroy
terraform apply push.tfplan
```

The new revision reads the key at start: if the secret has no version yet, the revision fails to deploy, so do step 2 first. Once AI-178 is on `main`, check Cloud Logging, `jsonPayload.component="push-sender"`: no `push not configured` line after the revision starts. Before that no code reads the keys, so there is no line either way. A test push comes with M7.11: Subscribe API and M7.12: Notification settings page.

## Turn it off or rotate

| Case       | How                                                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Off        | `push_enabled = false` in tfvars and the Actions variable, then apply: 1 to change; the next revision sends nothing                                                                                                                                      |
| Leaked key | Step 2 again (a new pair), step 3 with the new public key, then disable the old version: `gcloud secrets versions disable <n> --secret=vapid-private-key`. Every device must subscribe again: a subscription is bound to the public key it was made with |
