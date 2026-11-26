# Prod uptime and error alerts (AI-209: M6.19; ADR-0114 "shipped" includes knowing prod is down).
# An uptime check on the service's health path and an alert on its 5xx count, both to the
# notification channels passed in. Everything that names a project, host or address is a variable.
# Called by project-env for prod (prod_alerts_enabled); Andy applies (runbook project-env.md).
# Alert → ticket flow and error budgets are Later.

terraform {
  required_version = ">= 1.16, < 2.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.8"
    }
  }
}

locals {
  # Cost cap (ADR-0028): fixed, not variables. 3 regions every 5 minutes ≈ 26k executions a month,
  # inside the 1M free per project.
  uptime_period  = "300s"
  uptime_regions = ["USA_OREGON", "USA_IOWA", "USA_VIRGINIA"]
  runbook        = "andy-intelligence docs/runbooks/project-env.md \"Prod alerts\""
}

resource "google_monitoring_uptime_check_config" "health" {
  count = var.uptime_check_enabled ? 1 : 0

  project          = var.project_id
  display_name     = "${var.service_name} ${var.health_path}"
  period           = local.uptime_period
  timeout          = "10s"
  selected_regions = local.uptime_regions

  http_check {
    path           = var.health_path
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.service_host
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  count = var.uptime_check_enabled ? 1 : 0

  project               = var.project_id
  display_name          = "Prod down: ${var.service_name} ${var.health_path}"
  combiner              = "OR"
  severity              = "CRITICAL"
  notification_channels = var.notification_channel_ids

  conditions {
    display_name = "${var.health_path} failing from 2 or more regions for 5 minutes"
    condition_threshold {
      filter          = "resource.type = \"uptime_url\" AND metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id = \"${google_monitoring_uptime_check_config.health[0].uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period     = "600s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.project_id", "resource.label.host"]
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
    content   = "Prod health check failing for ${var.service_name} in ${var.project_id}. Check the latest revision and its logs; roll back from the Releases page or MCP if a release caused it (${local.runbook})."
  }
}

resource "google_monitoring_alert_policy" "errors" {
  project               = var.project_id
  display_name          = "Prod errors: ${var.service_name} 5xx"
  combiner              = "OR"
  severity              = "ERROR"
  notification_channels = var.notification_channel_ids

  conditions {
    display_name = "More than ${var.error_threshold_per_5m} 5xx responses in 5 minutes"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${var.service_name}\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.error_threshold_per_5m
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
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
    content   = "5xx responses from ${var.service_name} in ${var.project_id}. Check Cloud Run logs for the failing requests; roll back from the Releases page or MCP if a release caused it (${local.runbook})."
  }
}
