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

# Managed projects' budgets (AI-162: M6.14: Project budget module, ADR-0114). One entry per GCP
# project (a managed project's environment); each gets infra/modules/project-budget. Real project
# IDs go in the gitignored terraform.tfvars, never here.
variable "managed_projects" {
  type = map(object({
    project_id             = string
    budget_amount_usd      = optional(number, 10)
    region                 = optional(string, "us-central1")
    kill_switch_enabled    = optional(bool, false)
    kill_switch_ratio      = optional(number, 1.5)
    kill_switch_service    = optional(string)
    kill_switch_runtime_sa = optional(string)
  }))
  description = "Budget per managed project environment, keyed by a label like \"<project>-dev\". Defaults: $10/month, kill switch off."
  default     = {}

  validation {
    condition     = alltrue([for k, p in var.managed_projects : p.project_id != var.project_id])
    error_message = "A managed project can't be the control-plane project: its budget and kill switch are already managed above."
  }
  validation {
    condition     = length(distinct([for p in values(var.managed_projects) : p.project_id])) == length(var.managed_projects)
    error_message = "Each managed project's project_id must appear once."
  }
}
