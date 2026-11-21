# Threat model: Deployment reports

Detail on the deployment record's entry point (AI-180: M6.4, part of M6: Dev → prod releases in `docs/architecture/milestones.md`). Each deploy reports `started` and then `succeeded` or `failed` (environment, commit, image digest, revision), so release notes, verification and the DORA metrics (ADR-0040) read one record the control plane keeps. The report is authenticated like the run callbacks (ADR-0019) and never fails the deploy. Risk register, assets and mitigations: [threat-model.md](threat-model.md). PRs that change this area update this file; the weekly system review edits only the main file.

## Trust boundaries and entry points

| Entry point                                                                          | Who can reach it                                 | Authn/authz                                                                                                                                                                                                                                                                                                                         | Notes                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /deployments`, `POST /deployments/{id}/finish` (`apps/api/src/deployments.ts`) | Internet; meant for a project's own `deploy.yml` | GitHub Actions OIDC token (ADR-0019): issuer, audience (`PUBLIC_URL`), signature and expiry checked. `workflow_ref` must be exactly `<repository>/.github/workflows/deploy.yml@refs/heads/main`, and the repository must belong to an enabled registered project. Anything else is `403` with nothing written; a bad token is `401` | The token, not the body, sets the project and the commit (`sha` claim); the environment is fixed to `prod`. The body adds only the image digest at the start (`sha256:` + 64 hex) and status and revision at the end, each schema-checked, unknown fields refused. A finish is accepted only for a deployment of the same project and commit (`404` otherwise) and only once (`409`). |

## Caps (ADR-0028)

| What             | Cap                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Body             | 1 KB, refused before parsing (`413`)                                                                  |
| Verified reports | 30 a minute per instance, after verification, so forged tokens can't use it up (`429`)                |
| Writes           | One document per start, one update per finish; no reads beyond the deployment and the latest good one |

## Credentials

No new credential. The deploy job already holds `id-token: write` (for Workload Identity Federation); the same job token, with the control plane as audience, signs the reports. The report step masks it and never logs it (`platform/actions/report-deployment`).

## Residual risks

- **Push access to `main` can write records.** Whoever can change `deploy.yml` on `main` (Andy; later collaborators) can report deployments with any digest and status. The record is informational until verification and promotion read it (M6.5 on); those slices recheck what they act on.
- **Rerun of an old workflow run.** A rerun of an earlier `deploy.yml` run on `main` reports a new deployment of that earlier commit, which is true: it did deploy it again.
- **Lost reports.** A report that fails (control plane down, deploy of the control plane itself in progress) is a job-summary warning; the deploy goes on and the record is missing or stays `started`. The first deploy containing this route reports to the old revision, which answers `404`, so that one deploy isn't recorded.
