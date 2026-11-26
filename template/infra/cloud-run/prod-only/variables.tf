# Real values go in the gitignored terraform.tfvars (shape: terraform.tfvars.example) or TF_VAR_*.

variable "prod_project_id" {
  type        = string
  description = "Existing GCP project for prod (<app>-prod), on the billing account. Nothing here creates projects."
}

variable "region" {
  type        = string
  description = "Region of the Cloud Run services, registries and the kill switch."
  default     = "us-central1"
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name (2 to 18 lowercase letters, digits or hyphens)."
}

variable "github_repository" {
  type        = string
  description = "owner/name of this repo, in GitHub's exact case."
}

variable "github_repository_id" {
  type        = string
  description = "This repo's numeric ID: gh api repos/<owner>/<name> --jq .id"
}

variable "alert_email" {
  type        = string
  description = "Where usage alerts go. Personal data: keep it in terraform.tfvars or TF_VAR_alert_email."
  sensitive   = true
}

variable "billing_account_id" {
  type        = string
  description = "Cloud Billing account (XXXXXX-XXXXXX-XXXXXX) that pays for the project. Keep it out of the repo."
  sensitive   = true
}

variable "prod_budget_usd" {
  type        = number
  description = "Monthly budget for prod in USD (ADR-0028)."
  default     = 10
}

variable "kill_switch_enabled" {
  type        = bool
  description = "Opt-in cost kill switch: at 150% of the budget, scale the service to zero (project-budget module)."
  default     = false
}

variable "runtime_project_roles" {
  type        = list(string)
  description = "Extra project roles for the service's runtime identity (e.g. roles/datastore.user)."
  default     = []
}

variable "smoke_checks" {
  type        = string
  description = "DEPLOY_SMOKE_CHECKS: one check per line, `<path> <status>[,<status>…]`."
  default     = "/health 200"
}
