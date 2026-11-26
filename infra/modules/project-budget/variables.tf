variable "billing_account_id" {
  type        = string
  description = "Cloud Billing account ID (XXXXXX-XXXXXX-XXXXXX) that pays for project_id. Kept out of the public repo."
  sensitive   = true

  validation {
    condition     = can(regex("^[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}$", var.billing_account_id))
    error_message = "billing_account_id must look like 012345-6789AB-CDEF01 (no billingAccounts/ prefix)."
  }
}

variable "project_id" {
  type        = string
  description = "GCP project whose spend the budget tracks; the kill switch, when on, lives here too."

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a GCP project ID: 6 to 30 lowercase letters, digits or hyphens."
  }
}

variable "budget_amount_usd" {
  type        = number
  description = "Monthly budget in USD. Emails at 50%, 90%, 100% and kill_switch_ratio actual, and 100% forecast."
  default     = 10

  validation {
    condition     = var.budget_amount_usd > 0
    error_message = "budget_amount_usd must be greater than 0."
  }
}

variable "region" {
  type        = string
  description = "Region of the Cloud Run service and Cloud Tasks queues the kill switch stops."
  default     = "us-central1"
}

variable "kill_switch_enabled" {
  type        = bool
  description = "Opt-in cost kill switch (ADR-0028): at kill_switch_ratio of the budget, scale kill_switch_service to zero and pause Cloud Tasks queues. Off creates no kill switch resources."
  default     = false
}

variable "kill_switch_ratio" {
  type        = number
  description = "Actual spend / budget at which the kill switch trips (1.5 = 150%). Also an email threshold."
  default     = 1.5

  validation {
    # The upper bound keeps the threshold list's string sort in numeric order (main.tf).
    condition     = var.kill_switch_ratio >= 1 && var.kill_switch_ratio < 10
    error_message = "kill_switch_ratio must be at least 1 (100% of budget) and under 10."
  }
}

variable "kill_switch_service" {
  type        = string
  description = "Cloud Run service the kill switch takes offline. Required when kill_switch_enabled."
  default     = null

  validation {
    condition     = !var.kill_switch_enabled || try(length(var.kill_switch_service) > 0, false)
    error_message = "kill_switch_service is required when kill_switch_enabled is true."
  }
}

variable "kill_switch_runtime_sa" {
  type        = string
  description = "Email of kill_switch_service's runtime service account (Cloud Run checks actAs on it). Required when kill_switch_enabled."
  default     = null

  validation {
    condition     = !var.kill_switch_enabled || can(regex("^[a-z0-9-]+@[a-z0-9-]+\\.iam\\.gserviceaccount\\.com$", var.kill_switch_runtime_sa))
    error_message = "kill_switch_runtime_sa must be a service account email (name@project.iam.gserviceaccount.com) when kill_switch_enabled is true."
  }
}
