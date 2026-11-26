# 2026-11-26 — AI-201: M6.16: Project environment module

- Built `infra/modules/project-env`, the `cloud-run` deploy kind's module: one environment in an existing GCP project with a capped Cloud Run service, an optional `<service>-preview` service, a registry repo each (cleanup on), a Workload Identity pool for the one repo, a main deployer, a preview deployer, runtime identities, a log exclusion and the six M1.15 usage alerts.
- Main deployer federates on `workflow_ref`, one binding per file: `deploy.yml` and `release.yml` on `refs/heads/main` only. Preview deployer: `event_name == pull_request`; preview images get their own repo so PR code can't overwrite a main image.
- Choices made here (no ADR; in the PR description): the provider pins the repo's numeric ID; `promote_source_repository` gives prod's Cloud Run service agent read on the dev repo so promote ships the same digest.
- `platform/actions/terraform-check` now validates `infra/modules/` and their `examples/` roots and runs their `tests/`. Plan-only tests (mocked provider) cover the bindings, caps and refusals.
- Nothing applied. Andy applies per environment from the managed repo's root (runbook `project-env.md`): 38 + N adds with previews, 29 + N for prod in `dev-and-prod`.
