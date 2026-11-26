# Identities (threat model: docs/security/infrastructure.md, R-AI-201 to R-AI-201-4). No keys:
# GitHub Actions federates with this project's own pool; each role below is bound on one
# resource, never the project, except the runtime identities' log and trace writes.
#
# | Identity           | Federates from                                           | Can                                         |
# | ------------------ | -------------------------------------------------------- | ------------------------------------------- |
# | <svc>-deploy       | main_deployer_workflows on refs/heads/main               | push to repo <svc>, deploy service <svc>    |
# | <svc>-pr-deploy    | pull_request runs of the repo (forks get no OIDC token)  | push to <svc>-preview, deploy that service  |
# | <svc>-run          | (Cloud Run service <svc>)                                | logs, traces, runtime_project_roles         |
# | <svc>-pr-run       | (Cloud Run service <svc>-preview)                        | logs, traces; nothing else                  |

# ── Workload Identity Federation ────────────────────────────────────────────

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = var.wif_pool_id
  display_name              = "GitHub Actions"
  description               = "Deploys from ${var.github_repository} only (AI-201)"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository"    = "assertion.repository"
    "attribute.repository_id" = "assertion.repository_id"
    "attribute.event_name"    = "assertion.event_name"
    "attribute.ref"           = "assertion.ref"
    "attribute.workflow_ref"  = "assertion.workflow_ref"
  }

  # Only tokens minted for this one repo can federate at all; the ID pins it against a deleted
  # and re-created repo of the same name. Every binding below narrows further.
  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.repository_id == '${var.github_repository_id}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

locals {
  wif_principal_set = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}"
}

# ── Main deployer ───────────────────────────────────────────────────────────

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "${var.service_name}-deploy"
  display_name = "Deployer: ${var.service_name} from main"
  description  = "deploy.yml and release.yml on refs/heads/main of ${var.github_repository} (AI-201)"
}

# workflow_ref is "<owner>/<repo>/.github/workflows/<file>@<ref>": the top-level workflow and the
# ref it runs on. One binding per allowed file, so only those files, only on main, can deploy:
# a PR (ref refs/pull/N/merge), another branch, or any other workflow on main can't. A reusable
# workflow they call keeps the caller's workflow_ref.
resource "google_service_account_iam_member" "deployer_wif" {
  for_each           = toset(var.main_deployer_workflows)
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "${local.wif_principal_set}/attribute.workflow_ref/${var.github_repository}/.github/workflows/${each.value}@refs/heads/main"
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  project    = var.project_id
  location   = google_artifact_registry_repository.images[var.service_name].location
  repository = google_artifact_registry_repository.images[var.service_name].repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_cloud_run_v2_service_iam_member" "deployer_run" {
  project  = var.project_id
  name     = google_cloud_run_v2_service.main.name
  location = google_cloud_run_v2_service.main.location
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# Cloud Run checks actAs on the revision's runtime identity: this one only, so a deploy can't
# switch the service to another identity.
resource "google_service_account_iam_member" "deployer_acts_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

# ── Preview deployer (ADR-0114 "PR previews"; runs unmerged PR code) ──────

resource "google_service_account" "preview_deployer" {
  count        = local.preview
  project      = var.project_id
  account_id   = "${var.service_name}-pr-deploy"
  display_name = "Deployer: ${local.preview_name} from PRs"
  description  = "pull_request runs of ${var.github_repository}; ${local.preview_name} only (AI-201)"
}

# Same-repo PRs only: GitHub gives fork pull_request runs no id-token, and the provider's
# condition refuses any other repo. pull_request_target is a different event_name.
resource "google_service_account_iam_member" "preview_deployer_wif" {
  count              = local.preview
  service_account_id = google_service_account.preview_deployer[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "${local.wif_principal_set}/attribute.event_name/pull_request"
}

resource "google_artifact_registry_repository_iam_member" "preview_deployer_push" {
  count      = local.preview
  project    = var.project_id
  location   = google_artifact_registry_repository.images[local.preview_name].location
  repository = google_artifact_registry_repository.images[local.preview_name].repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.preview_deployer[0].email}"
}

resource "google_cloud_run_v2_service_iam_member" "preview_deployer_run" {
  count    = local.preview
  project  = var.project_id
  name     = google_cloud_run_v2_service.preview[0].name
  location = google_cloud_run_v2_service.preview[0].location
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.preview_deployer[0].email}"
}

resource "google_service_account_iam_member" "preview_deployer_acts_as_runtime" {
  count              = local.preview
  service_account_id = google_service_account.preview_runtime[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.preview_deployer[0].email}"
}

# ── Runtime identities: project roles in this project only ───────────────────

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "${var.service_name}-run"
  display_name = "Runtime: ${var.service_name}"
}

resource "google_project_iam_member" "runtime" {
  for_each = toset(concat(["roles/logging.logWriter", "roles/cloudtrace.agent"], var.runtime_project_roles))
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.runtime.email}"
}

# PR code runs as this identity, possibly in the prod project (prod-only): logs and traces only,
# never runtime_project_roles, so it reaches no data the main service can.
resource "google_service_account" "preview_runtime" {
  count        = local.preview
  project      = var.project_id
  account_id   = "${var.service_name}-pr-run"
  display_name = "Runtime: ${local.preview_name} (no data access)"
}

resource "google_project_iam_member" "preview_runtime" {
  for_each = var.preview_enabled ? toset(["roles/logging.logWriter", "roles/cloudtrace.agent"]) : toset([])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.preview_runtime[0].email}"
}
