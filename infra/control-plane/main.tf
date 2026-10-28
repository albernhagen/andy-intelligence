# Control plane: one Cloud Run service (API + MCP + SPA), its identities, Firestore,
# image registry, and Firebase/Identity Platform auth. Applied by Andy after reviewing
# the plan (CI checks the plan on PRs). App image updates are deployed by CI, not Terraform.

terraform {
  required_version = ">= 1.16, < 2.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.8"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 8.8"
    }
  }
  backend "gcs" {
    bucket = "andy-intelligence-512400-tfstate"
    prefix = "control-plane"
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  service_name   = "control-plane"
  repo_full_name = "${var.github_owner}/${var.github_repo}"
  # Cloud Run's deterministic URL; known before the service exists, so no dependency cycle.
  service_host = "${local.service_name}-${data.google_project.this.number}.${var.region}.run.app"
  wif_pool     = "projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/github"
}

resource "google_project_service" "apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "cloudtrace.googleapis.com",
    "firebase.googleapis.com",
    "firebaserules.googleapis.com",
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com", # usage alerts (ADR-0028)
    "run.googleapis.com",
    "secretmanager.googleapis.com", # used from M1 (GitHub App key, OAuth tokens)
  ])
  service            = each.value
  disable_on_destroy = false
}

# ── Images ──────────────────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "images" {
  location               = var.region
  repository_id          = "control-plane"
  format                 = "DOCKER"
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "30d"
    }
  }

  depends_on = [google_project_service.apis]
}

# ── Identities ──────────────────────────────────────────────────────────────

resource "google_service_account" "runtime" {
  account_id   = "control-plane-runtime"
  display_name = "Control plane runtime"
}

resource "google_project_iam_member" "runtime" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/cloudtrace.agent",
    # verifyIdToken(checkRevoked=true) reads the user record.
    "roles/firebaseauth.viewer",
    # Read/write Firestore documents (no admin: can't change indexes, rules, or the database).
    "roles/datastore.user",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# CI deploy identity: push images and roll the Cloud Run service. Nothing else.
resource "google_service_account" "deployer" {
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer"
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  # Only workflows running on main may deploy.
  member = "principalSet://iam.googleapis.com/${local.wif_pool}/attribute.ref/refs/heads/main"
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_cloud_run_v2_service_iam_member" "deployer_run" {
  name     = google_cloud_run_v2_service.control_plane.name
  location = google_cloud_run_v2_service.control_plane.location
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_acts_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

# ── Database: Firestore (ADR-0017) ──────────────────────────────────────────

resource "google_firestore_database" "default" {
  name                    = "(default)" # only the default database gets the free tier
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.apis]
}

# Server-only access: the Firebase web config is public, so client SDKs must be denied.
# The API uses IAM (runtime SA), which bypasses these rules.
resource "google_firebaserules_ruleset" "firestore_deny_all" {
  source {
    files {
      name    = "firestore.rules"
      content = "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }"
    }
  }
  depends_on = [google_firestore_database.default]
}

resource "google_firebaserules_release" "firestore" {
  name         = "cloud.firestore"
  ruleset_name = "projects/${var.project_id}/rulesets/${google_firebaserules_ruleset.firestore_deny_all.name}"
}

# ── Auth: Firebase + Identity Platform (Google sign-in) ─────────────────────

resource "google_firebase_project" "this" {
  provider   = google-beta
  project    = var.project_id
  depends_on = [google_project_service.apis]
}

resource "google_firebase_web_app" "ui" {
  provider        = google-beta
  project         = var.project_id
  display_name    = "andy-intelligence UI"
  deletion_policy = "DELETE"
  depends_on      = [google_firebase_project.this]
}

data "google_firebase_web_app_config" "ui" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.ui.app_id
}

resource "google_identity_platform_config" "this" {
  project = var.project_id

  authorized_domains = [
    "localhost",
    "${var.project_id}.firebaseapp.com",
    local.service_host,
  ]

  # Google sign-in only. The API returns these disabled blocks; declaring them keeps plans clean.
  sign_in {
    allow_duplicate_emails = false

    email {
      enabled           = false
      password_required = false
    }

    phone_number {
      enabled = false
    }
  }

  depends_on = [google_project_service.apis, google_firebase_project.this]
}

# NOTE: the Google sign-in provider itself is enabled manually in the console, because it
# needs an OAuth client and Google's OAuth client APIs can't be driven from Terraform.
# See docs/runbooks/m0-setup.md.

# ── Service ─────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "control_plane" {
  name     = local.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  # App-level auth (Firebase ID tokens + email allow-list) gates every /api route.
  # Cloud Run IAM can't be used: browsers and Claude's MCP connector call it directly (ADR-0010).
  invoker_iam_disabled = true

  template {
    service_account = google_service_account.runtime.email

    # Cost caps (ADR-0028): bound billed time per request and requests per instance.
    # API, webhook and Cloud Tasks handlers should answer fast; MCP streams reconnect.
    timeout                          = "60s"
    max_instance_request_concurrency = 80

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      # Placeholder until CI pushes the first real image; CI owns the image from then on.
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "ALLOWED_EMAILS"
        value = join(",", var.allowed_emails)
      }
      env {
        name  = "FIREBASE_API_KEY"
        value = data.google_firebase_web_app_config.ui.api_key
      }
      env {
        name  = "FIREBASE_AUTH_DOMAIN"
        value = data.google_firebase_web_app_config.ui.auth_domain
      }
    }
  }

  lifecycle {
    # CI deploys own the image and the revision labels deploy-cloudrun adds (commit-sha, managed-by).
    ignore_changes = [
      template[0].containers[0].image,
      template[0].labels,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.apis, google_firestore_database.default]
}

# ── Logs (ADR-0028) ─────────────────────────────────────────────────────────
# Retention stays at the _Default bucket's 30 days (no resource needed). Drop only the
# noisiest entries: successful request logs for static assets and /health. Errors still log.

resource "google_logging_project_exclusion" "run_noise" {
  name        = "control-plane-request-noise"
  description = "Successful Cloud Run request logs for static assets and /health"
  filter      = <<-EOT
    resource.type = "cloud_run_revision"
    AND resource.labels.service_name = "${local.service_name}"
    AND log_id("run.googleapis.com/requests")
    AND httpRequest.status < 400
    AND (httpRequest.requestUrl : "/assets/" OR httpRequest.requestUrl : "/health")
  EOT

  depends_on = [google_project_service.apis]
}

# ── Usage alerts (ADR-0028, M1.15: Usage alerts) ───────────────────────────
# Budgets lag by hours and nothing in GCP caps egress, Firestore ops or log volume,
# so these fire within minutes of a spike. Thresholds: var.usage_alert_thresholds.

resource "google_monitoring_notification_channel" "alert_email" {
  display_name = "Andy (usage alerts)"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
  depends_on = [google_project_service.apis]
}

locals {
  # Each alert sums a DELTA metric over a rolling window across all series, then compares.
  usage_alerts = {
    run-requests = {
      name      = "Cloud Run requests spike"
      filter    = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${local.service_name}\" AND metric.type = \"run.googleapis.com/request_count\""
      window    = "300s"
      threshold = var.usage_alert_thresholds.run_requests_per_5m
      what      = "requests in 5 minutes"
    }
    run-sent-bytes = {
      name      = "Cloud Run bytes sent spike"
      filter    = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${local.service_name}\" AND metric.type = \"run.googleapis.com/container/network/sent_bytes_count\""
      window    = "3600s"
      threshold = var.usage_alert_thresholds.run_sent_bytes_per_hour
      what      = "bytes sent in 1 hour (all outbound, not only internet egress)"
    }
    firestore-reads = {
      name      = "Firestore reads spike"
      filter    = "resource.type = \"firestore.googleapis.com/Database\" AND metric.type = \"firestore.googleapis.com/document/read_ops_count\""
      window    = "3600s"
      threshold = var.usage_alert_thresholds.firestore_reads_per_hour
      what      = "document reads in 1 hour"
    }
    firestore-writes = {
      name      = "Firestore writes spike"
      filter    = "resource.type = \"firestore.googleapis.com/Database\" AND metric.type = \"firestore.googleapis.com/document/write_ops_count\""
      window    = "3600s"
      threshold = var.usage_alert_thresholds.firestore_writes_per_hour
      what      = "document writes in 1 hour"
    }
    firestore-deletes = {
      name      = "Firestore deletes spike"
      filter    = "resource.type = \"firestore.googleapis.com/Database\" AND metric.type = \"firestore.googleapis.com/document/delete_ops_count\""
      window    = "3600s"
      threshold = var.usage_alert_thresholds.firestore_writes_per_hour
      what      = "document deletes in 1 hour"
    }
    log-bytes = {
      name      = "Log ingestion spike"
      filter    = "resource.type = \"global\" AND metric.type = \"logging.googleapis.com/billing/bytes_ingested\""
      window    = "3600s"
      threshold = var.usage_alert_thresholds.log_bytes_per_hour
      what      = "log bytes ingested in 1 hour (free tier: 50 GiB/month)"
    }
  }
}

resource "google_monitoring_alert_policy" "usage" {
  for_each = local.usage_alerts

  display_name          = "Usage: ${each.value.name}"
  combiner              = "OR"
  severity              = "WARNING"
  notification_channels = [google_monitoring_notification_channel.alert_email.id]

  conditions {
    display_name = "More than ${each.value.threshold} ${each.value.what}"
    condition_threshold {
      filter                  = each.value.filter
      comparison              = "COMPARISON_GT"
      threshold_value         = each.value.threshold
      duration                = "0s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"
      aggregations {
        alignment_period     = each.value.window
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Unexpected usage on the andy-intelligence control plane. Check Cloud Run, Firestore and Logs for a loop or abuse. Emergency stop and thresholds: docs/runbooks/billing.md in the repo."
  }

  depends_on = [google_project_service.apis]
}

