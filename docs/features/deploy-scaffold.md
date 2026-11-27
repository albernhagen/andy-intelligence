# Deploy scaffold

AI-109: M6.22, ADR-0114. When a repo is registered, its baseline PR carries what the project's [deploy kind](deploy-kind.md) needs to deploy. Nothing is applied: Andy applies it.

| Deploy kind | [Environments](environment-policy.md) | The baseline PR adds                                                                                                                                                                                                            |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`      | (not read)                            | No deploy files, no `infra/`                                                                                                                                                                                                    |
| `cloud-run` | `prod-only`                           | A Terraform root in `infra/`: `project-env` once (prod, with PR previews) and `project-budget` once; plus `.terraform-version` and a starter `Dockerfile`. The workflows come with `finish` ([deploy caller](deploy-caller.md)) |
| `cloud-run` | `dev-and-prod`                        | The same root with two environments: dev (first, previews) and prod (promote from dev's registry), each with its own budget                                                                                                     |

- **Dependabot:** a `cloud-run` project's managed `.github/dependabot.yml` adds monthly Terraform for `infra/` and Docker for `/` (base-image majors by hand); a `none` project's has no entry for a directory it lacks (AI-399).
- **Starter image (AI-401):** root `Dockerfile` and `.dockerignore` (`template/docker/`, seeded together): `node:24-slim` pinned by digest, `pnpm build`, then `dist/main.js` as user `node` on `$PORT` (8080). A new repo's starter adds `src/server.ts` (`/health` → 200). A repo with its own app edits the install step and `CMD`; its baseline PR says so.
- **Seed files:** the root and the Dockerfile are the project's own once written; the baseline never rewrites them. Modules are pinned to the baseline commit (`git::…//infra/modules/<name>?ref=<sha>`).
- **No IDs in the repo:** real project IDs, the billing account and the alert email go in the gitignored `infra/terraform.tfvars`; `terraform.tfvars.example` has fake values.
- **CI:** the root's `tests/plan.tftest.hcl` plans it with the example values and mocked providers (baseline `terraform-check`), here under `template/infra/` and in the managed repo under `infra/`.
- **Repo variables:** output `repo_variables` names every variable `deploy.yml`, `release.yml` and `preview.yml` read, with its value; one command sets them all.
- **Setup path:** step "Deploy environments" lists the commands for a `cloud-run` project (marked done by hand) and reads done for `none`.
- **A new kind** adds its own seed entries to `platform/baseline/manifest.json` (`deployKind`, optionally `environments`) and files under `template/infra/<kind>/`; registration doesn't change.

**How to use:** set the deploy kind and environments before registering the repo (Settings or MCP `set_deploy_kind`, `set_environments`). Then runbook [`project-env.md`](../runbooks/project-env.md). For a repo onboarded by the CLI: `baseline.mjs files <repo> --ref <ref> --deploy-kind cloud-run --environments <policy>`.

**Code:** `template/infra/cloud-run/`, `template/docker/`, `platform/baseline/manifest.json` (seed entries), `platform/baseline/files.mjs` (`renderFiles`, `pinModules`), `apps/api/src/github/registration.ts`, `packages/domain/src/onboarding.ts` (`deploy_env`).
