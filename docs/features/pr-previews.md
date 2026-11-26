# PR previews

AI-207: M6.18, ADR-0114 "PR previews". A `cloud-run` project gets `preview.yml` from the baseline (next to `deploy.yml` and `release.yml`: [`deploy-caller.md`](deploy-caller.md)).

| When                                  | What happens                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same-repo PR opened, pushed, reopened | Build the PR's image into the preview registry; deploy it to `<service>-preview` as a no-traffic revision tagged `pr-<n>`, as the preview deployer; one PR comment, updated each push, with the tagged URL |
| PR closed (merged or not)             | Remove the `pr-<n>` tag; the comment says the preview was removed                                                                                                                                          |
| An 11th preview                       | At most 10 `pr-<n>` tags per service: the least recently deployed goes first, checked before and after each deploy                                                                                         |
| Fork or Dependabot PR                 | No job, so no GCP credential                                                                                                                                                                               |

The preview has Cloud Run IAM on by default: open it with the `gcloud run services proxy … --tag pr-<n>` command in the comment. It runs as `<service>-pr-run` (logs and traces only, no prod data). Untagged old revisions serve nothing and cost nothing.

**How to use:** set the first environment's `PROJECT_ID`, `REGION`, `WIF_PROVIDER`, plus `PREVIEW_SERVICE`, `PREVIEW_DEPLOYER_SA`, `PREVIEW_IMAGE_REPO` (prefix `GCP_` or `GCP_DEV_`; [runbook](../runbooks/project-env.md) "After"), run the baseline with `--deploy-kind cloud-run`, open a PR. A missing one fails the run before any build, naming it.

**Code:** `template/.github/workflows/preview.yml`, `platform/actions/cloud-run-preview`, `scripts/cloud-run-preview.mjs`. Security: [`deploy-caller.md`](../security/deploy-caller.md), R-AI-207.
