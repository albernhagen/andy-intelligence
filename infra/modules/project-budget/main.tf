# Project budget (ADR-0028, ADR-0114 "Budgets and caps"): a monthly Cloud Billing budget for one
# GCP project with emails at 50%, 90%, 100% actual, the kill switch ratio, and 100% forecast,
# plus the opt-in cost kill switch (kill-switch.tf). Called once per managed project's
# environment by infra/billing. The caller's google provider needs a quota project with the
# Billing Budgets API on (user_project_override), or the Budget API returns 403.

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
  # The API takes whole units plus nanos; this lets the amount be a plain number (e.g. 0.01 for an alert test).
  budget_units = floor(var.budget_amount_usd)
  budget_nanos = floor((var.budget_amount_usd - floor(var.budget_amount_usd)) * 1000000000 + 0.5)
  # Email at the kill switch's limit too, whether or not the switch is on (matches the control plane).
  actual_thresholds = distinct(sort([for t in [0.5, 0.9, 1.0, var.kill_switch_ratio] : format("%.4f", t)]))
}

resource "google_billing_budget" "this" {
  billing_account = var.billing_account_id
  display_name    = "${var.project_id} monthly"

  # This project only, net of credits (free tier, promotions): alert on what is actually billed.
  budget_filter {
    projects               = ["projects/${data.google_project.this.number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(local.budget_units)
      nanos         = local.budget_nanos
    }
  }

  dynamic "threshold_rules" {
    for_each = local.actual_thresholds
    content {
      threshold_percent = tonumber(threshold_rules.value)
    }
  }
  # Keep this last: the API returns actual-spend rules before forecast ones, and a different
  # order here shows a swap on every plan.
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  # Threshold emails go to Google's default recipients (the billing account's Billing Account
  # Administrators and Users), so no address is in config. With the kill switch on, the budget
  # also publishes its status to the kill switch topic; default emails stay on.
  dynamic "all_updates_rule" {
    for_each = var.kill_switch_enabled ? [1] : []
    content {
      pubsub_topic                   = google_pubsub_topic.budget[0].id
      schema_version                 = "1.0"
      disable_default_iam_recipients = false
    }
  }
}
