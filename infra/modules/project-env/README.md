# Module `project-env`

The **`cloud-run` deploy kind's** Terraform module (ADR-0114: Dev → prod releases). Only projects whose `deployKind` is `cloud-run` use it; a project with `deployKind: none` has no deploy Terraform, and any later kind brings its own module. One call = one environment (`<app>-dev` or `<app>-prod`) in an **existing** GCP project; nothing here creates projects or budgets (`project-budget` does budgets).

Called by a template root in the managed repo (AI-109: M6.22); Andy plans and applies by hand ([runbook](../../../docs/runbooks/project-env.md)). [`examples/basic`](examples/basic) shows a call with fake IDs.

## What it creates

| Resource                                           | Detail                                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Run service `<service>`                      | Caps (ADR-0028): scale to zero, `max_instances` (2, at most 10), `concurrency` (80), `request_timeout_seconds` (60). Cloud Run IAM on unless `allow_unauthenticated`            |
| Cloud Run service `<service>-preview`              | `preview_enabled` (first environment only): PR revisions tagged `pr-<n>`, `preview_max_instances` (1, at most 3); Cloud Run IAM on unless `preview_allow_unauthenticated`       |
| Artifact Registry `<service>`, `<service>-preview` | Keep the newest 10, delete older than 30 days. Preview images have their own repo, so PR code can't overwrite a main image                                                      |
| Workload Identity pool + provider                  | Accepts tokens only from `github_repository` with `github_repository_id`                                                                                                        |
| `<service>-deploy` (main deployer)                 | Federates only from `deploy.yml` and `release.yml` on `refs/heads/main` (`main_deployer_workflows`). Push to `<service>`, `run.developer` on `<service>`, actAs `<service>-run` |
| `<service>-pr-deploy` (preview deployer)           | Federates only from `pull_request` runs of the repo (forks get no token). Push to `<service>-preview`, `run.developer` on that service, actAs `<service>-pr-run`                |
| `<service>-run`, `<service>-pr-run`                | Runtime identities: logs and traces in this project; `runtime_project_roles` for the main one only. No access to another environment                                            |
| Promote read (optional)                            | `promote_source_repository` on prod in `dev-and-prod`: this project's Cloud Run service agent reads the dev repo, so promote ships the same digest                              |
| Log exclusion, usage alerts                        | Successful `/health` and `/assets/` request logs dropped; the six M1.15 usage alerts to `alert_email`                                                                           |

Threat model: [`docs/security/infrastructure.md`](../../../docs/security/infrastructure.md), risks R-AI-201 to R-AI-201-4.

## Wiring a workflow

`google-github-actions/auth` with `workload_identity_provider` = output `workload_identity_provider` and `service_account` = `deployer_email` (deploy.yml, release.yml) or `preview_deployer_email` (the preview workflow). The job needs `permissions: id-token: write`. A workflow file renamed from `deploy.yml` or `release.yml` stops federating until `main_deployer_workflows` lists it.

## Tests

Plan-only, mocked provider, no credentials; `platform/actions/terraform-check` runs both in CI:

```bash
terraform -chdir=infra/modules/project-env init -backend=false && terraform -chdir=infra/modules/project-env test
```

```bash
terraform -chdir=infra/modules/project-env/examples/basic init -backend=false && terraform -chdir=infra/modules/project-env/examples/basic test
```
