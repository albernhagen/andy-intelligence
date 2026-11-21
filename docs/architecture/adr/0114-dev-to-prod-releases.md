---
title: Dev → prod releases design
status: proposed (AI-156; Andy decides at review)
date: 2026-11-20
amends: 0050 (environments), 0069 (the verification stage), ARCHITECTURE §4.6 (Cloud Deploy)
---

# 0114 — Dev → prod releases: Actions promote by digest, a Verifying stage, deployments recorded by the control plane

AI-156: M6.1: Releases design, under AI-153: M6: Dev → prod releases. Slices: `docs/architecture/m6-slices.md`.

## Questions for Andy

Each is written in with the recommended option. Merging this ADR accepts them; to choose differently, comment the option and the ADR changes before merge.

**1. Which tool should promote releases dev → prod: GitHub Actions with our safe-deploy action, or Google Cloud Deploy?**
ARCHITECTURE §4.6 names Cloud Deploy, but the control plane already deploys with `platform/actions/cloud-run-safe-deploy` (no-traffic revision, smoke test, then traffic; ADR-0076).

| Option                    | What it does                                                                                     | Cost                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Actions + safe-deploy | Promote deploys the same image digest to the next environment; rollback pins an earlier revision | Nothing new to run or pay for. History lives in our `Deployment` records, not a GCP console                                             |
| (b) Cloud Deploy          | Managed delivery pipeline: promote, rollback, approvals, its own console                         | One more GCP service, its service agent and IAM, a second deploy path beside the control plane's, a per-pipeline fee past the free tier |

Recommendation: (a). One deploy path for the control plane and every managed project; Cloud Deploy's approvals duplicate the owner-only promote we build anyway.

**2. Should the new stage be called Verifying, and should it apply to every project that deploys, including AI?**
ADR-0069 removed Monitoring and left the name and exit signal of its replacement to M6.

| Option                                 | What it does                                                                                    | Cost                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| (a) Verifying, every deploying project | Merge → Verifying; the first environment deploys; tests and a verify agent task decide the exit | AI's tickets wait for the prod deploy and a verify task (minutes, some quota) |
| (b) Verifying, `dev-and-prod` only     | MVP projects and AI keep merge → Done                                                           | Verification never runs where most projects live, nor on the control plane    |
| (c) Released                           | Exit when the change is on prod                                                                 | Measures shipping, not whether it works                                       |

Recommendation: (a). AI proves the flow before any new GCP project exists. The stage stays off per project (`verifyAfterMerge`) until verification runs (M6.7).

## Context and Problem Statement

M6 needs per-project environments (ADR-0050: MVP = one prod project + PR previews; dev + prod on opt-in), a pipeline with a budget and caps per project (ADR-0028), verification between Ready for review and Done (ADR-0069), promote and rollback from the UI and MCP, release notes, and DORA metrics (ADR-0040). The control plane deploys only itself today, and the control plane learns nothing about deploys.

## Decision Outcome

| Topic                | Decision                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment policy   | Project setting `environments`: `prod-only` (default) or `dev-and-prod`. GCP projects `<app>-prod` and, when opted in, `<app>-dev`, created by Andy (Terraform takes the project ID).                                                                                                                                                                                                                    |
| Deploy and promote   | GitHub Actions with `cloud-run-safe-deploy`: build the image once on push to `main`, deploy it to the first environment (dev, or prod for `prod-only`). Promote deploys the **same image digest** to prod. Rollback pins traffic to an earlier revision. Both run in `release.yml`, triggered by `repository_dispatch` so they run on `main`.                                                            |
| PR previews          | A separate `<service>-preview` Cloud Run service in the first environment's project; each same-repo PR gets a no-traffic revision tagged `pr-<n>`, at most 10. Its deployer identity is bound to `pull_request` runs and can deploy only that service; its runtime identity has no prod data access. Forks never deploy.                                                                                 |
| Deployment record    | Each deploy, promote or rollback reports `started` and `succeeded`/`failed` (environment, sha, image digest, revision, kind, actor) to the control plane over the Actions OIDC token (ADR-0019), checked against the project's repo, `refs/heads/main` and the workflow path. A failed report never fails the deploy.                                                                                    |
| Verifying stage      | Ready for review → **Verifying** → Done, behind `verifyAfterMerge` per project (off by default). A merge whose files are all docs or `infra/` goes straight to Done. A succeeded deployment to the first environment starts one verify agent task (project tests against the URL, then each acceptance criterion); pass → Done, fail → In progress and Needs-you. Over 2 hours in Verifying → Needs-you. |
| Promote and rollback | Owner-only routes and MCP tools `promote` and `rollback`, and buttons on a Releases page. The API sends `repository_dispatch` with the GitHub App token; it holds no Cloud Run credential. One request per project per minute.                                                                                                                                                                           |
| Release notes        | A release = PRs merged between the previous succeeded deployment's sha and this one's. Its notes reuse the per-PR notes AI-159: What's new stores on merge; no model call.                                                                                                                                                                                                                               |
| DORA (prod only)     | Deploy frequency: succeeded prod deployments per week. Lead time: median PR merge → first prod deployment containing it. Change failure rate: prod deployments followed by a rollback or failed verification before the next deploy. Time to restore: median failed deployment → next succeeded one.                                                                                                     |
| Budgets and caps     | Terraform modules in `infra/modules/` (`project-env`, `project-budget`, `project-alerts`), called by a template root in each managed repo (ADR-0038); Andy applies.                                                                                                                                                                                                                                      |

### Consequences

- Good: one deploy path everywhere; promote ships the exact image that was verified; project AI feeds release notes, DORA and Verifying from the first slices; no new GCP service or API credential.
- Bad: no managed delivery console, so history and approvals live in our records and UI; the PR-preview identity runs PR code, limited to one service; tickets on AI wait minutes longer once Verifying is on.
