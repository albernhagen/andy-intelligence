# Bootstrap: one-time, applied locally by Andy (ADR-0011).
# Creates the Terraform state bucket, GitHub OIDC federation, and the read-only plan identity.
# Everything else lives in ../control-plane.

terraform {
  required_version = ">= 1.16, < 2.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
  # Starts with local state. After first apply, migrate into the bucket it creates:
  #   terraform init -migrate-state -backend-config="bucket=<project_id>-tfstate"
  # (uncomment the backend block first).
  # backend "gcs" {
  #   prefix = "bootstrap"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  repo_full_name = "${var.github_owner}/${var.github_repo}"
}

resource "google_project_service" "apis" {
  for_each = toset([
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# ── Terraform state ─────────────────────────────────────────────────────────

resource "google_storage_bucket" "tfstate" {
  name                        = "${var.project_id}-tfstate"
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 20
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.apis]
}

# ── GitHub Actions → GCP via Workload Identity Federation (no keys) ───────────

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
    "attribute.ref"              = "assertion.ref"
  }

  # Only tokens minted for this one repository can federate.
  attribute_condition = "assertion.repository == '${local.repo_full_name}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# ── Read-only identity CI uses for `terraform plan` on PRs ───────────────────

resource "google_service_account" "tf_plan" {
  account_id   = "tf-plan"
  display_name = "Terraform plan (read-only, CI)"
}

resource "google_project_iam_member" "tf_plan" {
  for_each = toset([
    "roles/viewer",
    "roles/iam.securityReviewer",
    "roles/secretmanager.viewer",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.tf_plan.email}"
}

# Plan runs with -lock=false, so read access to state is enough.
resource "google_storage_bucket_iam_member" "tf_plan_state" {
  bucket = google_storage_bucket.tfstate.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.tf_plan.email}"
}

resource "google_service_account_iam_member" "tf_plan_wif" {
  service_account_id = google_service_account.tf_plan.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${local.repo_full_name}"
}
