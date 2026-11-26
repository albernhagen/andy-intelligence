# Runbook: apply a project environment (Andy)

For a managed project whose `deployKind` is `cloud-run`: one apply of the template root in the managed repo's `infra/` (AI-109: M6.22; the baseline PR seeds it, see [`deploy-scaffold.md`](../features/deploy-scaffold.md)). It calls `infra/modules/project-env` (AI-201: M6.16) and `infra/modules/project-budget` once per environment: once for `prod-only`, twice for `dev-and-prod`. Nothing in CI applies it. Run every command from a clone of the managed repo. The setup path's step "Deploy environments" lists the same commands.

## Before

- Each GCP project (`<app>-prod`, and `<app>-dev` for `dev-and-prod`) exists and is on the billing account. Its budget comes from this root: don't also add it to `infra/billing` `managed_projects` (`billing.md` §8), or it gets two.
- `cp infra/terraform.tfvars.example infra/terraform.tfvars` (gitignored) and fill in the real values: project IDs, `alert_email`, `billing_account_id`, `github_repository_id` (`gh api repos/<owner>/<name> --jq .id`). Never commit it.
- Your login can create service accounts, IAM bindings, a Workload Identity pool and budgets in those projects and on the billing account.
- The state bucket, once, in the prod project: no public access, versioned, keeping the last 10 old versions (state holds the alert email and IDs; R-AI-109):

```bash
gcloud storage buckets create gs://<prod project>-tfstate --project <prod project> --location us-central1 --uniform-bucket-level-access --public-access-prevention
```

```bash
gcloud storage buckets update gs://<prod project>-tfstate --versioning --lifecycle-file=<(echo '{"rule":[{"action":{"type":"Delete"},"condition":{"isLive":false,"numNewerVersions":10}}]}')
```

## Apply

```bash
terraform -chdir=infra init -backend-config="bucket=<prod project>-tfstate"
```

```bash
terraform -chdir=infra plan -out=deploy.tfplan
```

Expected **adds, 0 to change, 0 to destroy**, where N = entries in `runtime_project_roles`:

| Root           | Adds    | Made of                                                                     |
| -------------- | ------- | --------------------------------------------------------------------------- |
| `prod-only`    | 43 + N  | prod with previews (41 + N), Budget API + budget (2)                        |
| `dev-and-prod` | 75 + 2N | dev with previews (38 + N), prod (33 + N), Budget API + budget for each (4) |

An environment with previews: 7 APIs, 2 registry repos, pool + provider, 4 service accounts, 4 runtime role grants, main deployer 5 grants (2 federation, push, run, actAs), preview deployer 4 grants, 2 services, 1 log exclusion, 1 email channel, 6 usage alerts = 38; prod also gets the uptime check and 2 prod alerts (3, AI-209: M6.19), so 41. Dev in `dev-and-prod` has `prod_alerts_enabled = false`; prod there drops the 10 preview resources and adds 2 reads on the dev repo (Cloud Run service agent, main deployer). A root applied before AI-209 plans exactly those 3 adds for prod. `kill_switch_enabled = true` adds 15 per environment (billing runbook §8). Anything else (a change or destroy) is drift: stop and check.

```bash
terraform -chdir=infra apply deploy.tfplan
```

## After

- Set the managed repo's variables from the root's output `repo_variables`: every variable the baseline's `deploy.yml`, `release.yml` and `preview.yml` read (names, not credentials), with `DEPLOY_SMOKE_CHECKS` from `smoke_checks` (default `/health 200`; one check per line, kept intact by `--body`):

```bash
terraform -chdir=infra output -json repo_variables > repo-vars.json
```

```bash
jq -r 'keys[]' repo-vars.json | while read -r name; do gh variable set "$name" --repo <owner>/<name> --body "$(jq -r --arg n "$name" '.[$n]' repo-vars.json)"; done && rm repo-vars.json
```

Check: `gh variable list --repo <owner>/<name>`. Then mark "Deploy environments" done on the setup path. What each variable is (AI-206: M6.17). Prefix `GCP_` for prod, `GCP_DEV_` for dev; setting the dev ones makes dev the first environment:

| Variable (after the prefix) | From                                  |
| --------------------------- | ------------------------------------- |
| `PROJECT_ID`, `REGION`      | the inputs `project_id`, `region`     |
| `SERVICE`, `SERVICE_URL`    | outputs `service_name`, `service_url` |
| `WIF_PROVIDER`              | output `workload_identity_provider`   |
| `DEPLOYER_SA`               | output `deployer_email`               |
| `IMAGE_REPO`                | output `image_repository`             |

Plus `DEPLOY_SMOKE_CHECKS` (one check per line, `<path> <status>`, e.g. `/health 200`). A repo onboarded before AI-109: M6.22 has no `infra/`: run the baseline first with `--deploy-kind cloud-run --environments <policy>` (`onboard-a-repo.md` §5a), merge, then this runbook from the top. For PR previews (`preview.yml`, AI-207: M6.18; first environment only, with `preview_enabled = true`), also set, with the same prefix:

| Variable (after the prefix) | From                              |
| --------------------------- | --------------------------------- |
| `PREVIEW_SERVICE`           | output `preview_service_name`     |
| `PREVIEW_DEPLOYER_SA`       | output `preview_deployer_email`   |
| `PREVIEW_IMAGE_REPO`        | output `preview_image_repository` |

Without `PREVIEW_SERVICE` the `Preview` jobs skip; with only some set, the run fails at its first step naming the missing ones. Check: open a PR that changes code; its `Preview` run comments a `pr-<n>` URL; close it and the comment says the preview was removed.

- Check: the alert email channel shows in Monitoring → Alerting → Notification channels (Google sends no confirmation for email).
- A deleted pool keeps its ID for 30 days: re-creating within that window fails; undelete it (`gcloud iam workload-identity-pools undelete`) or set another `wif_pool_id`.
- The main service is public (Cloud Run IAM off) unless you set `allow_unauthenticated = false`; then deploys' smoke tests get 403.
- Images are deleted after 30 days unless among the newest 10 or tagged `release-*`. The baseline `deploy.yml` (prod-only) and `release.yml` (promote) tag what prod runs `release-<digest hex>` before traffic moves (AI-389: M6.23); tags are never removed, so every image prod ever served is kept (a few hundred MB each). An image prod served before that tag landed is not: tag it once by hand, `gcloud artifacts docker tags add <image_repository>/<service>@<digest> <image_repository>/<service>:release-<digest hex>` (the digest from the Releases page or `gcloud run revisions describe`).
- The main service has `deletion_protection`: set it false and apply before a destroy.

## Prod alerts

Module `infra/modules/project-alerts` (AI-209: M6.19), called by `project-env` while `prod_alerts_enabled` (default on). Both alerts email `alert_email` and auto-close after 24h. About $0.20/month per prod service (2 alert conditions at $0.10); the uptime check (~26k runs a month) is inside the 1M free per project.

| Alert                          | Fires when                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `Prod down: <service> /health` | `/health` (`health_path`) fails from 2 of 3 US regions for 5 minutes           |
| `Prod errors: <service> 5xx`   | More than 5 5xx responses in 5 minutes (`prod_error_threshold_per_5m`, ≤ 1000) |

- Check after apply: Monitoring → Uptime checks shows `<service> /health` passing. The app must answer `/health` with 2xx.
- When one fires: open the service's logs; if a release caused it, roll back from the Releases page or MCP (`deploy-and-rollback.md`).
- With `allow_unauthenticated = false` there is no uptime check (it can't send a token); the 5xx alert stays.
