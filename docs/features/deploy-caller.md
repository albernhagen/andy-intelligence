# Deploy caller

A managed project whose `deployKind` is `cloud-run` gets `deploy.yml` and `release.yml` from the baseline, with every andy-intelligence action pinned by SHA; a `none` project gets neither (ADR-0114). `deploy.yml`: on push to `main`, check the repo variables, build the image once, push it to the first environment's registry (dev, or prod without one), safe-deploy it with the project's smoke checks (tagging it `release-<digest hex>` when that is prod, so registry cleanup keeps it), report the deployment. `release.yml`: the control plane's promote and rollback workflow (`workflow_dispatch` only), reading the same variables. A missing variable fails the run before any build or cloud call, naming it.

Repo variables, from `infra/modules/project-env` (`GCP_*` prod, `GCP_DEV_*` dev; dev's presence makes dev the first environment): `PROJECT_ID`, `REGION`, `SERVICE`, `SERVICE_URL` (output `service_url`), `WIF_PROVIDER` (`workload_identity_provider`), `DEPLOYER_SA` (`deployer_email`), `IMAGE_REPO` (`image_repository`). Plus `DEPLOY_SMOKE_CHECKS`: lines `<path> <status>[,<status>…]`, e.g. `/health 200`; optional `DEPLOY_SMOKE_CHECKS_OTHER_HOSTS` for an app whose non-public hosts answer differently. Rollback also checks `/health` for 200.

**PR previews:** `preview.yml`, same baseline and variables: [`pr-previews.md`](pr-previews.md).

**How to use:** `npx -y github:albernhagen/andy-intelligence files <owner/repo> --ref origin/main --deploy-kind cloud-run`, then set the variables ([runbook](../runbooks/project-env.md) "After")
