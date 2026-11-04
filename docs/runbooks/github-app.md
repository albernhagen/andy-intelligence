# Runbook: connect GitHub and register projects

How Andy connects the control plane to GitHub from the UI, installs the App on repos and registers project #1 (ADR-0041: GitHub App credentials and webhook intake, amended by ADR-0043: GitHub App setup from the UI). Done once per control plane; §6 covers rotation.

You never handle the App's private key or webhook secret: GitHub hands them to the API, which writes them to Secret Manager.

The App's URLs come from `PUBLIC_URL` (`https://ai.andybernhagen.com`, ADR-0044). If you connected before the custom domain, change the App's Homepage, Setup and Webhook URLs by hand (runbook `custom-domain.md` §6).

| App                                                      | Permissions                                                                                                        | Webhook events                                                   | Credentials                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Control plane (default name `andy-intelligence-control`) | read: metadata, checks · write: contents, pull requests, actions (agent runs, [`agent-runs.md`](agent-runs.md) §1) | `pull_request`, `check_run`, `workflow_run` → `/webhooks/github` | Secret Manager (`github-app-private-key`, `github-webhook-secret`); IDs in Firestore `config/codeHost` |

## 1. Apply Terraform (`infra/control-plane`)

**Skip if already applied** (a plan shows `No changes`). Creates two secret containers, the runtime's read and add-version access to them, and the TTL policy for `codeHostEvents`; without them Connect fails with a Secret Manager permission error.

```sh
cd infra/control-plane
terraform plan -out=cp.tfplan
terraform apply cp.tfplan
```

- From scratch: 7 to add.
- If you already applied the M1.5 version (5 adds): **2 to add, 0 to change, 0 to destroy** (`google_secret_manager_secret_iam_member.runtime_adds_github_versions["github-app-private-key"]`, `…["github-webhook-secret"]`).

Merge and deploy the code before step 2.

## 2. Connect GitHub (UI)

1. Open the control plane → **GitHub** (top nav) → keep or change the App name → **Connect GitHub**. The name must be unique on GitHub and can't match an existing user or organization (`andy-intelligence` is taken, so the default is `andy-intelligence-control`).
2. On GitHub: **Create GitHub App for albernhagen**.
3. GitHub sends you back to `/settings/github/callback`; the page connects and shows "Connected as …". Use the same browser tab throughout: the check that the callback is yours lives in that tab.

If the name is taken or reserved, GitHub says so on its page: go back, change the name and click Connect again (a fresh state each time).

## 3. Install the App on repos

On Settings → GitHub: **Install on repos** → **Only select repositories** → `andy-intelligence` (and any project repo later) → Install. GitHub returns you to the settings page; reload to see the repo under "Installed on".

## 4. Register project #1

UI → `/projects`: Name `andy-intelligence`, Key `AI`, GitHub repo `albernhagen/andy-intelligence` (suggested from the installed repos) → Create project.

- `422 … not found, GitHub isn't connected, or the GitHub App isn't installed` → step 2 or 3.
- `409 … already belongs to project` → registered already.

## 5. M1.5 / M1.19 "Done when"

1. Open any PR on `andy-intelligence`. Within a minute, Firestore → `codeHostEvents` has documents for `pull_request` and `check_run` / `workflow_run` with `projectId: "ai"`. Logs: `gcloud logging read 'jsonPayload.component="github-webhook"' --limit 20 --project andy-intelligence-512400`.
2. **Replay is a no-op:** GitHub → Settings → Developer settings → GitHub Apps → the App → Advanced → Recent deliveries → a `pull_request` delivery → **Redeliver** → `200 {"result":"duplicate"}`; the document is unchanged.
3. **Repo token for the system review:** `gh workflow run system-security-review.yml --repo albernhagen/andy-intelligence -f token_check=true`. Only the `token-check` job runs (no agent, no Claude quota, no PR): it gets a token from the control plane, lists the repos it reaches (must be `andy-intelligence` only), and revokes it. Pass = notice "Repo token issued … used and revoked". The real `publish` path (PR from `<app-slug>[bot]` whose checks start without an approval banner) runs on the next review with a threat-model change. Logs: `jsonPayload.component="github-token"`.
4. Firestore adapter suites (Java 21+, see `mcp-connector.md` §1b): `pnpm test:firestore`.
5. Optional, `CodeHost` contract against real GitHub (puts the key on disk briefly; mints one real token):

```sh
gcloud secrets versions access latest --secret github-app-private-key --project andy-intelligence-512400 > /tmp/app.pem
GITHUB_APP_ID=<App ID> GITHUB_APP_SLUG=<slug> GITHUB_APP_PRIVATE_KEY_FILE=/tmp/app.pem \
  GITHUB_CONTRACT_REPO=albernhagen/andy-intelligence pnpm vitest run --project github
rm /tmp/app.pem
```

App ID and slug: Firestore `config/codeHost`, or Settings → GitHub.

## 6. Rotate

New versions take effect within 5 minutes (the API's cache); no redeploy.

| What                      | How                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private key               | App settings → **Generate a private key** → `gcloud secrets versions add github-app-private-key --data-file=<downloaded .pem> --project andy-intelligence-512400` → delete the file → after 5 minutes delete the old key in App settings → `gcloud secrets versions disable <old> --secret github-app-private-key`. |
| Webhook secret            | `openssl rand -hex 32 \| tr -d '\n' \| pbcopy`, then `pbpaste \| gcloud secrets versions add github-webhook-secret --data-file=-` → paste into App settings → Webhook secret → clear the clipboard (`pbcopy < /dev/null`). Deliveries in the next 5 minutes may fail; redeliver them.                               |
| Start over with a new App | Delete the App on GitHub, delete Firestore `config/codeHost`, wait 5 minutes, then step 2.                                                                                                                                                                                                                          |

## Troubleshooting

| Symptom                                                               | Fix                                                                                                                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Callback page: "This link didn't come from your Connect GitHub click" | Started in another tab or the page was reloaded after connecting. Go to Settings → GitHub; if not connected, start again. Codes expire after an hour. |
| Callback: "GitHub rejected the code"                                  | Code expired or used. Delete the half-made App on GitHub (Developer settings → GitHub Apps) and start again.                                          |
| `403` / `500` from Secret Manager when connecting                     | Step 1 not applied (`runtime_adds_github_versions`).                                                                                                  |
| Deliveries show `503 GitHub is not connected`                         | Step 2 not done, or within 10 s of connecting. Redeliver.                                                                                             |
| Deliveries show `401 invalid signature`                               | Webhook secret mismatch (§6 webhook secret row).                                                                                                      |
| Deliveries show `202 ignored, reason repo`                            | Repo not registered (§4), or registered < 60 s ago.                                                                                                   |
| Deliveries show `429`                                                 | Signed-delivery cap hit (300/minute per instance; unsigned requests don't count). Redeliver later. GitHub doesn't retry on its own.                   |
| System review `publish`: "Control plane refused a repo token"         | `403 forbidden`: workflow or branch isn't in `TOKEN_POLICY` (`apps/api/src/github/token.ts`). `403 … not installed`: §3. `503`: §2.                   |
