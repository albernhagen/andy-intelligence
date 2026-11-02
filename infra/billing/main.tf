# Billing guardrails (ADR-0028, ADR-0029): a Cloud Billing budget with email alerts for the
# control-plane project, and the opt-in cost kill switch (kill-switch.tf). Budgets belong to
# the billing account, so they live in their own root.
# Plans and applies are local only (Andy): CI runs fmt/validate but has no billing access.

terraform {
  required_version = ">= 1.16, < 2.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.8"
    }
  }
  backend "gcs" {
    bucket = "andy-intelligence-512400-tfstate"
    prefix = "billing"
  }
}

# The Budget API needs a quota project with user credentials, or it returns 403.
provider "google" {
  project               = var.project_id
  user_project_override = true
  billing_project       = var.project_id
}

data "google_project" "this" {
  project_id = var.project_id
}

resource "google_project_service" "billingbudgets" {
  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
}

locals {
  # The API takes whole units plus nanos; this lets the amount be a plain number (e.g. 0.01 for an alert test).
  budget_units = floor(var.budget_amount_usd)
  budget_nanos = floor((var.budget_amount_usd - floor(var.budget_amount_usd)) * 1000000000 + 0.5)
}

resource "google_billing_budget" "control_plane" {
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

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  # Email at the kill switch's default limit too, whether or not the switch is on.
  threshold_rules {
    threshold_percent = 1.5
  }
  # Keep this order: the API returns actual-spend rules before forecast ones, and a different
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

  depends_on = [google_project_service.billingbudgets]
}
