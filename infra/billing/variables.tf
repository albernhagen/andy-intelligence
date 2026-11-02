variable "project_id" {
  type        = string
  description = "GCP project whose spend the budget tracks (also the API quota project)."
  default     = "andy-intelligence-512400"
}

variable "billing_account_id" {
  type        = string
  description = "Cloud Billing account ID (XXXXXX-XXXXXX-XXXXXX). Not a secret, but kept out of the public repo: set it in the gitignored terraform.tfvars."
  sensitive   = true

  validation {
    condition     = can(regex("^[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}$", var.billing_account_id)) && var.billing_account_id != "XXXXXX-XXXXXX-XXXXXX"
    error_message = "billing_account_id must be your real billing account ID, like 012345-6789AB-CDEF01 (no billingAccounts/ prefix)."
  }
}

variable "budget_amount_usd" {
  type        = number
  description = "Monthly budget in USD. Alerts fire at 50%, 90%, 100% actual and 100% forecast."
  default     = 25

  validation {
    condition     = var.budget_amount_usd > 0
    error_message = "budget_amount_usd must be greater than 0."
  }
}

variable "region" {
  type        = string
  description = "Region of the control-plane Cloud Run service and Cloud Tasks queues."
  default     = "us-central1"
}

variable "kill_switch_enabled" {
  type        = bool
  description = "Opt-in cost kill switch (ADR-0028): at kill_switch_ratio of the budget, scale the control plane to zero and pause Cloud Tasks queues. Off by default; set it in terraform.tfvars."
  default     = false
}

variable "kill_switch_ratio" {
  type        = number
  description = "Actual spend / budget at which the kill switch trips (1.5 = 150%)."
  default     = 1.5

  validation {
    condition     = var.kill_switch_ratio >= 1
    error_message = "kill_switch_ratio must be at least 1 (100% of budget)."
  }
}

variable "kill_switch_service" {
  type        = string
  description = "Cloud Run service the kill switch takes offline."
  default     = "control-plane"
}
