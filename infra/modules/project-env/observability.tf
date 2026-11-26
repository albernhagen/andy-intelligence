# Log exclusions and the M1.15 usage alerts (ADR-0028), the same design as infra/control-plane.
# Budgets lag by hours and nothing in GCP caps egress, Firestore ops or log volume, so these fire
# within minutes of a spike. Uptime and error alerts are AI-208's (M6.19), budgets project-budget's.

locals {
  services_filter = join(" OR ", [for s in local.services : "resource.labels.service_name = \"${s}\""])
  paths_filter    = join(" OR ", [for p in var.log_exclusion_paths : "httpRequest.requestUrl : \"${p}\""])
}

resource "google_logging_project_exclusion" "run_noise" {
  count       = length(var.log_exclusion_paths) > 0 ? 1 : 0
  project     = var.project_id
  name        = "${var.service_name}-request-noise"
  description = "Successful Cloud Run request logs for ${join(", ", var.log_exclusion_paths)}"
  filter      = <<-EOT
    resource.type = "cloud_run_revision"
    AND (${local.services_filter})
    AND log_id("run.googleapis.com/requests")
    AND httpRequest.status < 400
    AND (${local.paths_filter})
  EOT

  depends_on = [google_project_service.apis]
}

resource "google_monitoring_notification_channel" "alert_email" {
  project      = var.project_id
  display_name = "Usage alerts (${var.service_name})"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
  depends_on = [google_project_service.apis]
}

locals {
  run_filter = "resource.type = \"cloud_run_revision\" AND (${local.services_filter})"
  # Each alert sums a DELTA metric over a rolling window across all series, then compares.
  usage_alerts = {
    run-requests = {
      name      = "Cloud Run requests spike"
      filter    = "${local.run_filter} AND metric.type = \"run.googleapis.com/request_count\""
      window    = "300s"
      threshold = var.usage_alert_thresholds.run_requests_per_5m
      bytes     = false
      what      = "requests in 5 minutes"
    }
    run-sent-bytes = {
      name      = "Cloud Run bytes sent spike"
      filter    = "${local.run_filter} AND metric.type = \"run.googleapis.com/container/network/sent_bytes_count\""
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

  project               = var.project_id
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
    content   = "Unexpected usage in ${var.project_id} (${var.service_name}). Check Cloud Run, Firestore and Logs for a loop or abuse. Emergency stop: the project's cost kill switch or scale the service to zero (andy-intelligence docs/runbooks/billing.md)."
  }

  depends_on = [google_project_service.apis]
}
