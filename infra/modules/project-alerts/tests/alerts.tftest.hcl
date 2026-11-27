# Plan-only tests with a mocked google provider (AI-209: M6.19): no credentials, no cloud calls.
# Run: terraform -chdir=infra/modules/project-alerts init -backend=false && terraform -chdir=infra/modules/project-alerts test

mock_provider "google" {
  mock_resource "google_monitoring_uptime_check_config" {
    override_during = plan
    defaults = {
      uptime_check_id = "example-health-abc123"
    }
  }
}

variables {
  project_id               = "example-prod-000000"
  service_name             = "example"
  service_host             = "example-abc123-uc.a.run.app"
  notification_channel_ids = ["projects/example-prod-000000/notificationChannels/111"]
}

run "given_defaults_when_planned_then_uptime_check_calls_health_over_https_every_5_minutes_from_3_regions" {
  command = plan

  assert {
    condition     = google_monitoring_uptime_check_config.health[0].http_check[0].path == "/health" && google_monitoring_uptime_check_config.health[0].http_check[0].use_ssl && google_monitoring_uptime_check_config.health[0].monitored_resource[0].labels.host == "example-abc123-uc.a.run.app"
    error_message = "The uptime check must GET https://<service_host>/health."
  }
  assert {
    condition     = google_monitoring_uptime_check_config.health[0].period == "300s" && length(google_monitoring_uptime_check_config.health[0].selected_regions) == 3
    error_message = "Cost cap (ADR-0028): every 5 minutes from exactly 3 regions."
  }
}

run "given_defaults_when_planned_then_both_alerts_go_only_to_the_given_channels" {
  command = plan

  assert {
    condition     = google_monitoring_alert_policy.uptime[0].notification_channels == tolist(["projects/example-prod-000000/notificationChannels/111"]) && google_monitoring_alert_policy.errors.notification_channels == tolist(["projects/example-prod-000000/notificationChannels/111"])
    error_message = "Both alerts must notify exactly the channels passed in."
  }
  assert {
    condition     = strcontains(google_monitoring_alert_policy.uptime[0].conditions[0].condition_threshold[0].filter, "metric.labels.check_id = \"example-health-abc123\"")
    error_message = "The uptime alert must watch this module's check only."
  }
}

run "given_defaults_when_planned_then_error_alert_counts_only_this_services_5xx" {
  command = plan

  assert {
    condition     = strcontains(google_monitoring_alert_policy.errors.conditions[0].condition_threshold[0].filter, "resource.labels.service_name = \"example\"") && strcontains(google_monitoring_alert_policy.errors.conditions[0].condition_threshold[0].filter, "response_code_class = \"5xx\"")
    error_message = "The error alert must count 5xx responses of this one service."
  }
  assert {
    condition     = google_monitoring_alert_policy.errors.conditions[0].condition_threshold[0].threshold_value == 5
    error_message = "Default threshold: more than 5 5xx responses in 5 minutes."
  }
}

run "given_uptime_check_disabled_when_planned_then_only_the_error_alert_exists" {
  command = plan

  variables {
    uptime_check_enabled = false
  }

  assert {
    condition     = length(google_monitoring_uptime_check_config.health) == 0 && length(google_monitoring_alert_policy.uptime) == 0
    error_message = "A service behind Cloud Run IAM gets no uptime check (it can't send a token)."
  }
  assert {
    condition     = output.uptime_check_id == null && length(output.alert_policy_names) == 1
    error_message = "Only the error alert remains."
  }
}

run "given_no_channels_when_planned_then_refused" {
  command = plan

  variables {
    notification_channel_ids = []
  }

  expect_failures = [var.notification_channel_ids]
}

run "given_a_url_as_host_when_planned_then_refused" {
  command = plan

  variables {
    service_host = "https://example.run.app/health"
  }

  expect_failures = [var.service_host]
}

run "given_an_uncapped_threshold_when_planned_then_refused" {
  command = plan

  variables {
    error_threshold_per_5m = 5000
  }

  expect_failures = [var.error_threshold_per_5m]
}
