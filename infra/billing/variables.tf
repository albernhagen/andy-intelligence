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
