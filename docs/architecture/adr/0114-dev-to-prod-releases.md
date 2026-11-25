---
title: Dev → prod releases design
status: proposed (AI-156; Andy decided the options on 2026-11-25, accepted when merged)
date: 2026-11-25
amends: 0050 (environments), 0069 (the verification stage), ARCHITECTURE §4.6 (Cloud Deploy)
---

# 0114 — Dev → prod releases: deploy kinds, Actions promote by digest, a Verifying stage

AI-156: M6.1: Releases design, under AI-153: M6: Dev → prod releases.

## Context and Problem Statement

M6 needs per-project environments (ADR-0050), a deploy pipeline with a budget and caps per project (ADR-0028), a verification stage between Ready for review and Done (ADR-0069), promote and rollback from the UI and MCP, release notes, and DORA metrics (ADR-0040). Today the control plane deploys only itself and records nothing about deploys. Managed projects will not all deploy the same way (a Cloud Run service, a static site, nothing at all), so the control plane must not depend on how a project deploys.

## Decisions (Andy, 2026-11-25, on ticket AI-156)

1. **Promote with GitHub Actions and `platform/actions/cloud-run-safe-deploy`, not Google Cloud Deploy.** This deviates from ARCHITECTURE §4.6, which named Cloud Deploy; ARCHITECTURE changes in the same PR. Why: one deploy path for the control plane and every managed project, nothing new to run or pay for, and Cloud Deploy's approvals would duplicate the owner-only promote built anyway.
2. **A Verifying stage for every project that deploys, including project AI.** Merge → Verifying → Done. Project AI proves the flow before any new GCP project exists.
3. **Deploy kinds.** The control plane depends only on a small release contract (below). How a project builds and ships is its **deploy kind**, picked by a project setting. Only the `cloud-run` kind is built in M6; any other kind (a static site, say) is a later ticket of its own.

## Decision Outcome

### Deploy kind: the project setting

| Setting        | Values                                                                                                                                    | Default                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `deployKind`   | `none` (the project does not deploy) or `cloud-run`                                                                                       | `none`                         |
| `environments` | `prod-only` (one `<app>-prod` GCP project + PR previews) or `dev-and-prod` (adds `<app>-dev`); read only when `deployKind` is `cloud-run` | `prod-only` (AI-160, ADR-0050) |

- `none`: no deploy or release workflow, no Verifying stage (merge → Done), no Releases page actions, no deploy Terraform.
- Project AI: `cloud-run`, `prod-only`.
- A kind adds a value to `deployKind`; it never changes the contract. `deployKind` (how a project ships) is not the Deployment record's `kind` (deploy, promote or rollback). Each kind brings its own composite action in `platform/actions/`, Terraform module and template files (ADR-0038).

### The release contract every kind meets

| Part                 | What the project provides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflows            | Two workflows on `main`. `deploy.yml` runs on push to `main` and deploys to the first environment. `release.yml` runs only by `workflow_dispatch`, with inputs `action` (`promote` or `rollback`), `environment` (`dev` or `prod`), `digest` (what promote ships: a succeeded deployment's `imageDigest`), `revision` (what rollback returns to: a succeeded deployment's `revision`) and `request` (the control plane's request ID). No secrets in inputs: they show in public run logs. One run at a time per environment.                                                                                                                                                                 |
| Deployment record    | Each run reports `started`, then `succeeded` or `failed`, over the Actions OIDC callback AI-180: M6.4 built (ADR-0019) into the `Deployment` record (AI-161: M6.3). The token gives repository and `gitSha`; the body gives `imageDigest` (the `sha256:` content digest of the build output: a container image for `cloud-run`, a bundle for a later kind) and, at the end, `revision` (the runtime's name for what now serves). M6 adds `environment`, `kind` (deploy, promote or rollback), `url` (where verification tests run) and `request` to the start report, and accepts `release.yml` beside `deploy.yml`, both only on `refs/heads/main`. A failed report never fails the deploy. |
| Promote and rollback | The API starts `release.yml` by `workflow_dispatch` on `main` with the GitHub App token. Promote passes a `digest` from a succeeded deployment of the same project to the next environment; rollback passes an earlier succeeded `revision`. The API holds no cloud credential; the workflow's own deployer identity does the work.                                                                                                                                                                                                                                                                                                                                                          |

### The `cloud-run` kind (the only kind built in M6)

| Topic              | Decision                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deploy and promote | `cloud-run-safe-deploy` (no-traffic revision, smoke test, then traffic; ADR-0076). Build the image once on push to `main`, deploy it to the first environment (dev, or prod for `prod-only`). Promote deploys the **same image digest** to prod. Rollback pins traffic to an earlier revision.                           |
| PR previews        | A separate `<service>-preview` Cloud Run service in the first environment's project; each same-repo PR gets a no-traffic revision tagged `pr-<n>`, at most 10. Its deployer identity is bound to `pull_request` runs and can deploy only that service; its runtime identity has no prod data access. Forks never deploy. |
| Budgets and caps   | Terraform modules in `infra/modules/` (`project-env`, `project-budget`, `project-alerts`), called by a template root in each managed repo (ADR-0038); Andy applies.                                                                                                                                                      |

### Across kinds

| Topic                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verifying stage      | Ready for review → **Verifying** → Done for every project whose `deployKind` is not `none`; no per-project opt-out. A merge whose files are all docs or `infra/` goes straight to Done. A succeeded deployment to the first environment starts one verify agent task (project tests against `url`, then each acceptance criterion); pass → Done, fail → In progress and Needs-you. Over 2 hours in Verifying → Needs-you. The stage turns on for these projects when the verify task (AI-188: M6.7) ships. |
| Promote and rollback | Owner-only routes and MCP tools `promote` and `rollback`, and buttons on a Releases page. One request per project per minute.                                                                                                                                                                                                                                                                                                                                                                              |
| Release notes        | A release = PRs merged between the previous succeeded deployment's sha and this one's. Its notes reuse the per-PR notes AI-159: What's new stores on merge; no model call.                                                                                                                                                                                                                                                                                                                                 |
| DORA (prod only)     | Deploy frequency: succeeded prod deployments per week. Lead time: median PR merge → first prod deployment containing it. Change failure rate: prod deployments followed by a rollback or failed verification before the next deploy. Time to restore: median failed deployment → next succeeded one.                                                                                                                                                                                                       |

### Consequences

- Good: the control plane, Releases page, Verifying, release notes and DORA work the same for any kind; a new kind is a workflow, an action and a module, not a control-plane change. One deploy path for the control plane and Cloud Run projects; promote ships the exact image that was verified; no new GCP service and no cloud credential in the API.
- Bad: no managed delivery console, so history and approvals live in our records and UI; the PR-preview identity runs PR code, limited to one service; tickets on project AI wait minutes longer once Verifying is on; the contract's field names must stay stable once a second kind exists.
