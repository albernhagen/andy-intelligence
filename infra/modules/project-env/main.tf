# Project environment (AI-201: M6.16; ADR-0114 "The `cloud-run` kind"): one environment of a
# managed project in an existing GCP project. Cloud Run service with ADR-0028 caps, an optional
# <service>-preview service for PR previews (ADR-0050), Artifact Registry with cleanup, runtime
# and deployer identities over Workload Identity Federation (identities.tf), log exclusions and
# the M1.15 usage alerts (observability.tf). Called by a template root in the managed repo;
# Andy applies (ADR-0011).

terraform {
  required_version = ">= 1.16, < 2.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.8"
    }
  }
}

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  preview_name = "${var.service_name}-preview"
  preview      = var.preview_enabled ? 1 : 0
  services     = var.preview_enabled ? [var.service_name, local.preview_name] : [var.service_name]
  # Cloud Run's service agent pulls images when a revision is created.
  run_service_agent = "serviceAccount:service-${data.google_project.this.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

resource "google_project_service" "apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com", # deployers' federated tokens
    "logging.googleapis.com",
    "monitoring.googleapis.com", # usage alerts (ADR-0028)
    "run.googleapis.com",
    "sts.googleapis.com", # Workload Identity Federation
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ── Images ──────────────────────────────────────────────────────────────────
# Preview images go to their own repo, so PR code can't overwrite an image main deploys.

resource "google_artifact_registry_repository" "images" {
  for_each = toset(local.services)

  project                = var.project_id
  location               = var.region
  repository_id          = each.value
  format                 = "DOCKER"
  description            = each.value == var.service_name ? "Images built on main (deploy.yml)" : "PR preview images"
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = var.image_keep_count
    }
  }
  # Cloud Run needs the image to start new instances of a revision, so an image prod runs or may
  # roll back to must not be deleted; tag it with a keep prefix.
  dynamic "cleanup_policies" {
    for_each = length(var.image_keep_tag_prefixes) > 0 ? [1] : []
    content {
      id     = "keep-tagged-releases"
      action = "KEEP"
      condition {
        tag_state    = "TAGGED"
        tag_prefixes = var.image_keep_tag_prefixes
      }
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "${var.image_max_age_days}d"
    }
  }

  depends_on = [google_project_service.apis]
}

# Promote (dev-and-prod, on prod): Cloud Run here pulls the verified digest straight from the
# dev repo. Read on that one repo for the service agent only; no runtime identity gets it.
resource "google_artifact_registry_repository_iam_member" "promote_source_read" {
  count      = var.promote_source_repository == null ? 0 : 1
  project    = var.promote_source_repository.project_id
  location   = var.promote_source_repository.location
  repository = var.promote_source_repository.repository
  role       = "roles/artifactregistry.reader"
  member     = local.run_service_agent

  depends_on = [google_project_service.apis]
}

# Promote also tags the digest it ships `release-<hex>` in that repo, so the dev repo's cleanup
# keeps what prod runs (AI-389). No tag-only predefined role exists; writer also lets this
# deployer push there, but dev deploys only the digest its own build pushed.
resource "google_artifact_registry_repository_iam_member" "promote_source_tag" {
  count      = var.promote_source_repository == null ? 0 : 1
  project    = var.promote_source_repository.project_id
  location   = var.promote_source_repository.location
  repository = var.promote_source_repository.repository
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}
