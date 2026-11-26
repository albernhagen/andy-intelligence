# Runbook: apply a project environment (Andy)

For a managed project whose `deployKind` is `cloud-run`: one apply per environment of `infra/modules/project-env` (AI-201: M6.16), from the template root in the managed repo (AI-109: M6.22 adds that root; until then, copy `infra/modules/project-env/examples/basic`). Nothing in CI applies it.

## Before

- The GCP project exists, is on the billing account, and has its budget (`billing.md` §8).
- Real values go in a gitignored `terraform.tfvars` or `TF_VAR_*`, never the repo: project ID, `alert_email`, `github_repository_id` (`gh api repos/<owner>/<name> --jq .id`).
- Your login can create service accounts, IAM bindings and a Workload Identity pool in that project.

## Apply

```bash
terraform init && terraform plan -out=env.tfplan
```

Expected **adds, 0 to change, 0 to destroy**, where N = entries in `runtime_project_roles`:

| Environment                                                     | Adds   |
| --------------------------------------------------------------- | ------ |
| First environment, with previews (`prod-only`, or dev)          | 38 + N |
| Prod in `dev-and-prod` (`preview_enabled = false`, promote set) | 30 + N |

38 = 7 APIs, 2 registry repos, pool + provider, 4 service accounts, 4 runtime role grants, main deployer 5 grants (2 federation, push, run, actAs), preview deployer 4 grants, 2 services, 1 log exclusion, 1 email channel, 6 alerts. Prod in `dev-and-prod` drops the 10 preview resources and adds 2 reads on the dev repo (Cloud Run service agent, main deployer). Anything else (a change or destroy) is drift: stop and check.

```bash
terraform apply env.tfplan
```

## After

- Set the managed repo's variables for the baseline's `deploy.yml` and `release.yml` (AI-206: M6.17; names, not credentials). Prefix `GCP_` for prod, `GCP_DEV_` for dev; setting the dev ones makes dev the first environment:

  | Variable (after the prefix) | From                                  |
  | --------------------------- | ------------------------------------- |
  | `PROJECT_ID`, `REGION`      | the inputs `project_id`, `region`     |
  | `SERVICE`, `SERVICE_URL`    | outputs `service_name`, `service_url` |
  | `WIF_PROVIDER`              | output `workload_identity_provider`   |
  | `DEPLOYER_SA`               | output `deployer_email`               |
  | `IMAGE_REPO`                | output `image_repository`             |

  Plus `DEPLOY_SMOKE_CHECKS` once per repo (one check per line, `<path> <status>`, e.g. `/health 200`). Each with `gh variable set <NAME> --repo <owner>/<name> --body <value>`. Then run the baseline with `--deploy-kind cloud-run` (`onboard-a-repo.md` §5a). For PR previews (`preview.yml`, AI-207: M6.18; first environment only, with `preview_enabled = true`), also set, with the same prefix:

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
