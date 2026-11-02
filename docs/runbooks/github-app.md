# Runbook: GitHub Apps and project registration

How Andy creates the two GitHub Apps, stores their credentials, turns on the webhook receiver and registers project #1 (ADR-0040: GitHub App credentials and webhook intake). Done once; §7 covers rotation.

Never paste a private key, webhook secret or manifest `code` into chat, a file in a repo, or tfvars. The commands below pipe them straight into Secret Manager or GitHub.

| App           | Name                           | Permissions                                              | Webhook                                                          | Installed on                         | Credentials                 |
| ------------- | ------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------ | --------------------------- |
| Control plane | `andy-intelligence`            | read: metadata, contents, pull requests, checks, actions | `pull_request`, `check_run`, `workflow_run` → `/webhooks/github` | every project repo                   | Secret Manager              |
| Review bot    | `andy-intelligence-review-bot` | write: contents, pull requests                           | none                                                             | `albernhagen/andy-intelligence` only | `system-review` environment |

## 1. Apply Terraform, step 1 (`infra/control-plane`)

Creates the two empty secrets, the runtime's access to them, and a Firestore TTL policy for `codeHostEvents`.

```sh
cd infra/control-plane
terraform plan -out=cp.tfplan   # expect: 5 to add, 0 to change, 0 to destroy
terraform apply cp.tfplan
```

Adds: `google_secret_manager_secret.github["github-app-private-key"]`, `…["github-webhook-secret"]`, two `google_secret_manager_secret_iam_member.runtime_reads_github`, `google_firestore_field.code_host_event_ttl`.

## 2. Create the control-plane App (manifest flow)

```sh
node platform/github-app/form.mjs control-plane > /tmp/cp-app.html && open /tmp/cp-app.html
```

1. Click **Create GitHub App**, then **Create GitHub App for albernhagen** on GitHub. If the name is taken, change `name` in `platform/github-app/control-plane.json` and commit that.
2. GitHub redirects to `http://localhost:1/?code=…&state=…`. The page fails to load on purpose: the code stays in your address bar and reaches no server. Copy the `code` value (valid 1 hour).
3. Exchange the code and store the credentials without writing them to disk:

```sh
read -s "CODE?manifest code: "    # zsh; paste the code, nothing is echoed
json=$(gh api -X POST "/app-manifests/$CODE/conversions")
jq -r .pem <<<"$json" | gcloud secrets versions add github-app-private-key --data-file=- --project andy-intelligence-512400
jq -j .webhook_secret <<<"$json" | gcloud secrets versions add github-webhook-secret --data-file=- --project andy-intelligence-512400
jq -r '"App ID: \(.id)  slug: \(.slug)"' <<<"$json"
unset json CODE
rm /tmp/cp-app.html
```

`jq -j` matters: a trailing newline in the webhook secret breaks every signature.

4. Install it: `https://github.com/apps/<slug>/installations/new` → **Only select repositories** → `andy-intelligence` → Install.

## 3. Apply Terraform, step 2: turn the receiver on

Add the App ID to your gitignored `infra/control-plane/terraform.tfvars`:

```hcl
github_app_id = "<App ID from step 2>"
```

and the same value as an Actions **variable** (not a secret; CI plans need it to match):

```sh
gh variable set TF_VAR_GITHUB_APP_ID --repo albernhagen/andy-intelligence --body "<App ID>"
```

```sh
terraform plan -out=cp.tfplan   # expect: 0 to add, 1 to change, 0 to destroy
terraform apply cp.tfplan
```

Change: `google_cloud_run_v2_service.control_plane` gets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` (new revision, current image). The code must be deployed (this PR merged) first, or the old image just ignores the env vars.

Check: the App's **Advanced** tab → Recent deliveries → the `ping` from creation → **Redeliver** → response `200 {"result":"pong"}`.

## 4. Register project #1

In the UI (`/projects`): Name `andy-intelligence`, Key `AI`, GitHub repo `albernhagen/andy-intelligence` → Create project.

- `422 … GitHub App isn't installed` → step 2.4 missed or a typo.
- `409 … already belongs to project` → the repo is registered already.

## 5. Create the review bot App

```sh
node platform/github-app/form.mjs review-bot > /tmp/bot-app.html && open /tmp/bot-app.html
```

Create it as in step 2.1–2.2, then:

```sh
gh api -X PUT repos/albernhagen/andy-intelligence/environments/system-review \
  --input - <<<'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
gh api -X POST repos/albernhagen/andy-intelligence/environments/system-review/deployment-branch-policies \
  -f name=main -f type=branch
read -s "CODE?manifest code: "
json=$(gh api -X POST "/app-manifests/$CODE/conversions")
jq -r .pem <<<"$json" | gh secret set REVIEW_BOT_PRIVATE_KEY --env system-review --repo albernhagen/andy-intelligence
gh variable set REVIEW_BOT_CLIENT_ID --repo albernhagen/andy-intelligence --body "$(jq -r .client_id <<<"$json")"
jq -r '"slug: \(.slug)"' <<<"$json"
unset json CODE
rm /tmp/bot-app.html
```

Install it on `andy-intelligence` only (`https://github.com/apps/<slug>/installations/new`).

Check: `gh workflow run system-security-review.yml --repo albernhagen/andy-intelligence`. If it opens a PR, the author is `<slug>[bot]` and its checks start without an approval banner. (No threat-model change → no PR; try again next week.)

## 6. M1.5 "Done when" and local checks

1. Open any PR on `andy-intelligence` (this PR's follow-up commit is fine). Within a minute, Firestore console → `codeHostEvents` has documents for `pull_request` and `check_run` / `workflow_run`, each with `projectId: "ai"`. Logs: `gcloud logging read 'jsonPayload.component="github-webhook"' --limit 20 --project andy-intelligence-512400`.
2. **Replay is a no-op:** App settings → Advanced → Recent deliveries → pick a `pull_request` delivery → **Redeliver**. Response `200 {"result":"duplicate"}`; the document is unchanged (same `receivedAt`).
3. Firestore adapter suite (needs Java 21+, see `mcp-connector.md` §1b): `pnpm test:firestore`.
4. Optional, `CodeHost` contract against real GitHub (needs the control-plane key on disk briefly):

```sh
gcloud secrets versions access latest --secret github-app-private-key --project andy-intelligence-512400 > /tmp/app.pem
GITHUB_APP_ID=<App ID> GITHUB_APP_PRIVATE_KEY_FILE=/tmp/app.pem GITHUB_CONTRACT_REPO=albernhagen/andy-intelligence \
  pnpm vitest run --project github
rm /tmp/app.pem
```

## 7. Rotate

| What                      | How                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control-plane private key | App settings → Generate a private key → `gcloud secrets versions add github-app-private-key --data-file=<downloaded .pem>` → delete the file → redeploy (any merge, or `gcloud run services update control-plane --region us-central1 --update-labels rotated=$(date +%s)`) → delete the old key in App settings → `gcloud secrets versions disable <old> --secret github-app-private-key`. |
| Webhook secret            | `openssl rand -hex 32 \| tr -d '\n' \| pbcopy`, then `pbpaste \| gcloud secrets versions add github-webhook-secret --data-file=-` → redeploy → paste into App settings → Webhook secret → clear the clipboard (`pbcopy < /dev/null`). Deliveries between the redeploy and the paste fail; redeliver them.                                                                                   |
| Review bot key            | App settings → Generate a private key → `gh secret set REVIEW_BOT_PRIVATE_KEY --env system-review < <file>` → delete the file and the old key.                                                                                                                                                                                                                                              |

## Troubleshooting

| Symptom                                                                    | Fix                                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Deliveries show `401 invalid signature`                                    | Webhook secret mismatch (often a trailing newline). Redo the webhook-secret row of §7.          |
| Deliveries show `202 ignored, reason repo`                                 | Repo not registered to a project (§4), or registered < 60 s ago (cache).                        |
| Revision fails to start: `missing required env var GITHUB_APP_PRIVATE_KEY` | A secret has no version: redo step 2.3.                                                         |
| Deliveries show `429`                                                      | Rate cap hit (300/minute per instance). Wait, then redeliver the failed ones.                   |
| System review: "Review bot App not configured"                             | Step 5: `REVIEW_BOT_CLIENT_ID` variable or `REVIEW_BOT_PRIVATE_KEY` environment secret missing. |
