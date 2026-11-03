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
  # What browsers, Claude and GitHub use (ADR-0044). The run.app host keeps serving but isn't a
  # sign-in domain, OAuth issuer or OIDC audience.
  public_url = "https://${var.custom_domain}"
  wif_pool   = "projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/github"
}

resource "google_project_service" "apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "cloudtasks.googleapis.com", # run watchdog queue (M1.2: Ticket core)
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

# Daily backups kept 7 days (Andy, 2026-11-01). Restore: docs/runbooks/m0-setup.md.
resource "google_firestore_backup_schedule" "daily" {
  database  = google_firestore_database.default.name
  retention = "604800s"
  daily_recurrence {}
}

# MCP OAuth grants (ADR-0039: MCP OAuth facade) carry a `ttl` timestamp; Firestore deletes
# them after it passes (usually within a day). The API ignores expired grants anyway.
resource "google_firestore_field" "oauth_grant_ttl" {
  database   = google_firestore_database.default.name
  collection = "oauthGrants"
  field      = "ttl"
  ttl_config {}
  index_config {} # not queried: no single-field indexes
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
    var.custom_domain,
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

# ── Custom domain (ADR-0044) ────────────────────────────────────────────────
# Preview feature, $0 (a load balancer would be ~$18/month). The account that applies this must
# be a verified Search Console owner of the apex domain; the CNAME and verification TXT live in
# infra/dns. Google issues the certificate once the CNAME resolves (usually ~15 min, up to 24 h).

resource "google_cloud_run_domain_mapping" "public" {
  name     = var.custom_domain
  location = var.region

  metadata {
    namespace = var.project_id
  }

  # A plain name, not a reference to the service: a reference would make the service a dependency,
  # so the runbook's targeted apply of this mapping would also switch PUBLIC_URL before the
  # certificate exists (runbook custom-domain.md §3).
  spec {
    route_name = local.service_name
  }
}

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
      # OAuth issuer and MCP resource URL (ADR-0039); MCP is off without it.
      env {
        name  = "PUBLIC_URL"
        value = local.public_url
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

  depends_on = [
    google_project_service.apis,
    google_firestore_database.default,
  ]
}

# ── GitHub App (ADR-0041: GitHub App credentials and webhook intake) ─────────────
# Secret containers only. The API writes the versions itself when Andy connects GitHub from
# the UI (ADR-0043: GitHub App setup from the UI), so values never pass through Terraform,
# state, env vars or a terminal. IDs match CODE_HOST_SECRETS in packages/store.

resource "google_secret_manager_secret" "github" {
  for_each  = toset(["github-app-private-key", "github-webhook-secret"])
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

# The runtime reads these two secrets only (no project-wide accessor role).
resource "google_secret_manager_secret_iam_member" "runtime_reads_github" {
  for_each  = google_secret_manager_secret.github
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# The setup flow adds versions to these two secrets only (no delete, no IAM, no other secret).
resource "google_secret_manager_secret_iam_member" "runtime_adds_github_versions" {
  for_each  = google_secret_manager_secret.github
  secret_id = each.value.id
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# Webhook records (codeHostEvents) carry a `ttl` 30 days after receipt; Firestore deletes them
# after it passes (ADR-0028: bounded storage).
resource "google_firestore_field" "code_host_event_ttl" {
  database   = google_firestore_database.default.name
  collection = "codeHostEvents"
  field      = "ttl"
  ttl_config {}
  index_config {} # not queried: no single-field indexes
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
      bytes     = false
      what      = "requests in 5 minutes"
    }
    run-sent-bytes = {
      name      = "Cloud Run bytes sent spike"
      filter    = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${local.service_name}\" AND metric.type = \"run.googleapis.com/container/network/sent_bytes_count\""
      window    = "3600s"
      threshold = var.usage_alert_thresholds.run_sent_bytes_per_hour
      bytes     = true
      what      = "sent in 1 hour (all outbound, not only internet egress)"
    }
    firestore-reads = {
      name      = "Firestore reads spike"
      filter    = "resource.type = \"firestore.googleapis.com/Database\" AND metric.type = \"firestore.googleapis.com/document/read_ops_count\""
      window    = "3600s"
      threshold = var.usage_alert_thresholds.firestore_reads_per_hour
      bytes     = false
      what      = "document reads in 1 hour"
    }
    firestore-writes = {
      name      = "Firestore writes spike"
      filter    = "resource.type = \"firestore.googleapis.com/Database\" AND metric.type = \"firestore.googleapis.com/document/write_ops_count\""
      window    = "3600s"
      threshold = var.usage_alert_thresholds.firestore_writes_per_hour
      bytes     = false
      what      = "document writes in 1 hour"
    }
    firestore-deletes = {
      name      = "Firestore deletes spike"
      filter    = "resource.type = \"firestore.googleapis.com/Database\" AND metric.type = \"firestore.googleapis.com/document/delete_ops_count\""
      window    = "3600s"
      threshold = var.usage_alert_thresholds.firestore_writes_per_hour
      bytes     = false
      what      = "document deletes in 1 hour"
    }
    log-bytes = {
      name      = "Log ingestion spike"
      filter    = "resource.type = \"global\" AND metric.type = \"logging.googleapis.com/billing/bytes_ingested\""
      window    = "3600s"
      threshold = var.usage_alert_thresholds.log_bytes_per_hour
      bytes     = true
      what      = "of logs ingested in 1 hour (free tier: 50 GiB/month)"
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
    display_name = "More than ${each.value.bytes ? "${format("%g", each.value.threshold / 1048576)} MiB" : each.value.threshold} ${each.value.what}"
    condition_threshold {
      filter          = each.value.filter
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = "0s"
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


# ── Run watchdog queue (ARCHITECTURE §7.1; used from M1.6: Claude Code executor) ──
# One task per dispatched run, delivered at the run's deadline. Capped (ADR-0028): a bug
# that enqueues in a loop can't fan out into unbounded Cloud Run requests.

resource "google_cloud_tasks_queue" "run_watchdog" {
  name     = "run-watchdog"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 5
    max_concurrent_dispatches = 5
  }

  retry_config {
    max_attempts       = 3
    min_backoff        = "10s"
    max_backoff        = "300s"
    max_retry_duration = "3600s"
  }

  depends_on = [google_project_service.apis]
}

# Identity whose OIDC token Cloud Tasks attaches to each delivery; the API checks the token's
# email and audience. It has no roles: it only proves "this call came from our queue".
resource "google_service_account" "tasks_invoker" {
  account_id   = "tasks-invoker"
  display_name = "Cloud Tasks invoker (run watchdog)"
}

# The runtime enqueues watchdog tasks on this queue only...
resource "google_cloud_tasks_queue_iam_member" "runtime_enqueues" {
  name     = google_cloud_tasks_queue.run_watchdog.name
  location = google_cloud_tasks_queue.run_watchdog.location
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.runtime.email}"
}

# ...and may name the invoker SA as the tasks' identity (actAs on that one SA).
resource "google_service_account_iam_member" "runtime_acts_as_invoker" {
  service_account_id = google_service_account.tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime.email}"
}
