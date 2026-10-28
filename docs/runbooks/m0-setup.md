# M0: Foundations — setup runbook (Andy)

One-time steps that need your credentials. **This repo is public:** nothing in these steps puts a secret, email address, or credential into a file that gets committed. Values that must stay private go in Secret Manager, GitHub Actions **secrets**, or gitignored local files.

## 0. GitHub settings

**Let Claude push branches** — install the Claude GitHub App on the org:

1. Open https://github.com/apps/claude/installations/select_target → choose your personal account **albernhagen**.
2. Repository access → **Only select repositories** → `andy-intelligence` → Install.

**Secret protection** (Settings → Advanced Security / Code security):

- Enable **Secret scanning** and **Push protection** (free on public repos). Push protection rejects pushes containing known credential formats, from anyone, including agents.

**Protect `main`** (Settings → Rules → Rulesets → New branch ruleset). Name `main`, enforcement **Active**, bypass list empty, target **Include default branch**.

| Rule                                        | Set                                                                                        | Why                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Restrict deletions                          | On                                                                                         | `main` can't be deleted                                                                                  |
| Block force pushes                          | On                                                                                         | History can't be rewritten                                                                               |
| Require a pull request before merging       | On — required approvals **0**; allowed merge method **Squash**                             | All changes go through a PR. 0 approvals because you can't approve your own PRs.                         |
| Require linear history                      | On                                                                                         | One squashed commit per slice                                                                            |
| Require status checks to pass               | On — add `check`, `terraform`, `trufflehog`; leave "require branches to be up to date" off | Leave out `plan`: it only runs when `infra/control-plane` changes, so requiring it would block other PRs |
| Restrict creations / updates                | Off                                                                                        | Would block merges                                                                                       |
| Require signed commits                      | Off                                                                                        | Agent commits aren't signed                                                                              |
| Require deployments to succeed              | Off                                                                                        | No GitHub environments                                                                                   |
| Require code scanning results               | Off for now                                                                                | Turned on in M1.10: Security review automation, once CodeQL runs                                         |
| Code quality, code coverage, Copilot review | Off                                                                                        | Not used; Copilot review costs AI credits and duplicates the security-review agent                       |

**Outside contributions** (Settings → Actions → General):

- Fork pull request workflows → **Require approval for all external contributors**.

**Your commit email** (your personal Settings → Emails): enable **Keep my email addresses private** and **Block command line pushes that expose my email**, and use `albernhagen@users.noreply.github.com` locally. The repo's existing "Initial commit" already shows your Gmail; that's public now and can't be removed without force-pushing `main`.

## 1. Prerequisites (your machine)

Install tools (macOS). Terraform comes from **tenv**, which reads the repo's `.terraform-version` and installs that version automatically (ADR-0024). If Terraform or tfenv is already installed via Homebrew, `brew uninstall` it first so tenv's `terraform` is the one on your `PATH`.

```sh
brew install --cask google-cloud-sdk
brew install tenv
cd andy-intelligence && terraform -version   # prints the version in .terraform-version
```

Sign in:

```sh
gcloud auth login
gcloud auth application-default login
gcloud config set project andy-intelligence-512400
gcloud auth application-default set-quota-project andy-intelligence-512400   # Identity Platform rejects ADC calls without it
gcloud billing projects describe andy-intelligence-512400                    # must show billingEnabled: true
```

You need Owner on `andy-intelligence-512400`; the project creator has it.

## 2. Bootstrap (state bucket + GitHub federation)

**From scratch only:** comment out the `backend "gcs"` block in `infra/bootstrap/main.tf` first — the bucket it points at doesn't exist yet. (Done once on 2026-10-27; state now lives in GCS.)

```sh
cd infra/bootstrap
terraform init
terraform providers lock -platform=darwin_arm64 -platform=linux_amd64   # lock file for your Mac and CI
terraform plan -out=bootstrap.tfplan    # review
terraform apply bootstrap.tfplan
```

Move bootstrap state into the bucket it just created:

1. Uncomment the `backend "gcs"` block.
2. `terraform init -migrate-state` → answer `yes`.
3. Delete the local `terraform.tfstate*` and `*.tfplan` files; `terraform plan` should say "No changes".
4. Commit `main.tf` and both `.terraform.lock.hcl` files in a PR. Never commit `.tfvars`, `.tfstate`, or `.tfplan`.

Set GitHub **repository variables** (Settings → Secrets and variables → Actions → **Variables**) from `terraform output`:

| Variable           | Output                       |
| ------------------ | ---------------------------- |
| `GCP_WIF_PROVIDER` | `workload_identity_provider` |
| `GCP_TF_PLAN_SA`   | `tf_plan_service_account`    |

These are identifiers, not secrets.

## 3. Control plane

Your allow-listed email never goes in the repo:

```sh
cd infra/control-plane
cp terraform.tfvars.example terraform.tfvars   # gitignored; put your Google account email in it
terraform init
terraform providers lock -platform=darwin_arm64 -platform=linux_amd64
terraform plan -out=cp.tfplan                  # review in full (CI only prints the summary line)
terraform apply cp.tfplan
```

Add a GitHub Actions **secret** (Secrets tab, not Variables) `TF_VAR_ALLOWED_EMAILS` with the same value in HCL list form, e.g. `["you@example.com"]`, so CI plans match yours.

If the first apply errors on the Firebase web app config or Identity Platform (API enablement can take a minute to propagate), re-run `plan`/`apply`.

Add the remaining repository **variables** from `terraform output`:

| Variable          | Output                     |
| ----------------- | -------------------------- |
| `GCP_DEPLOYER_SA` | `deployer_service_account` |
| `GCP_IMAGE_REPO`  | `image_repository`         |

## 4. Enable Google sign-in (manual — can't be done in Terraform)

Terraform has already created the Firebase project, web app, and Identity Platform config. The Google provider needs an OAuth client, which only the console can create:

1. https://console.firebase.google.com → project **andy-intelligence-512400** → **Build → Authentication**. (If prompted "Get started", click it.)
2. **Sign-in method** tab → **Add new provider** → **Google** → toggle **Enable**.
3. Public-facing name: `andy-intelligence`; support email: your Google account → **Save**.
4. **Settings** tab → **Authorized domains**: confirm the `control-plane-<number>.us-central1.run.app` domain is listed (Terraform adds it).

Only emails in `allowed_emails` get past the API; anyone else can complete Google sign-in but receives 403.

## 5. Database

Nothing to do. Firestore is created by step 3's Terraform (ADR-0017): no account, no connection string, no secret. Client access is denied by security rules; only the API's service account can read and write.

## 6. First deploy

The **Deploy control plane** workflow builds the image, pushes it, rolls Cloud Run, and smoke-tests `/health` (200) and `/api/me` (401). It skips itself until the step 2–3 repository variables exist.

- PR #1: Foundations not merged yet → merge it; the deploy runs.
- Already merged → GitHub → **Actions** → **Deploy control plane** → **Run workflow** on `main`.

## 7. Verify M0: Foundations "Done when"

- [ ] Open the `service_url` output (`https://control-plane-<project-number>.us-central1.run.app`; the `-uc.a.run.app` hash URL isn't an authorized sign-in domain), sign in with Google → "Needs you" page shows your email.
- [ ] Sign in with a different Google account → "not allowed" message (API returns 403).
- [ ] `curl -i <service_url>/api/me` → 401.
- [ ] `terraform plan` in `infra/control-plane` → "No changes".
- [ ] Firestore console shows the `(default)` database in `us-central1` with deny-all rules.

## Upgrading Terraform

Do upgrades in their own PR, never mixed with feature work.

| Upgrade       | Steps                                                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Terraform CLI | Edit `.terraform-version` → `terraform -version` (tenv installs it) → `terraform plan` in both `infra/` roots shows no unexpected changes → PR. CI reads the same file.                                                                                                                          |
| Providers     | In each `infra/` root: `terraform init -upgrade` → `terraform providers lock -platform=darwin_arm64 -platform=linux_amd64` → review `plan` → PR with the updated `.terraform.lock.hcl`. Major versions: read the provider's upgrade guide first and widen the `version` constraint in `main.tf`. |
