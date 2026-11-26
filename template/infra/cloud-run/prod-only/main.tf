# Deploy environments for this project: `cloud-run` deploy kind, `prod-only` (ADR-0114; seeded by
# the andy-intelligence baseline, AI-109: M6.22). One environment, <app>-prod, with PR previews and
# a monthly budget. This file is the project's own once written: the baseline never rewrites it.
# Nothing in CI applies it; Andy applies it locally (andy-intelligence runbook
# docs/runbooks/project-env.md). Real IDs go in the gitignored terraform.tfvars, never here.

terraform {
  required_version = ">= 1.16, < 2.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.8"
    }
  }
  # Bucket at init: terraform init -backend-config="bucket=<prod project>-tfstate"
  backend "gcs" {
    prefix = "deploy"
  }
}

# The Budget API needs a quota project with user credentials (user_project_override), or it
# returns 403; the environment's own project is that quota project.
provider "google" {
  project               = var.prod_project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.prod_project_id
}

module "prod" {
  source = "../../../../infra/modules/project-env"

  project_id            = var.prod_project_id
  region                = var.region
  service_name          = var.service_name
  github_repository     = var.github_repository
  github_repository_id  = var.github_repository_id
  alert_email           = var.alert_email
  runtime_project_roles = var.runtime_project_roles
  preview_enabled       = true
}

resource "google_project_service" "prod_billingbudgets" {
  project            = var.prod_project_id
  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
}

module "prod_budget" {
  source = "../../../../infra/modules/project-budget"

  billing_account_id     = var.billing_account_id
  project_id             = var.prod_project_id
  region                 = var.region
  budget_amount_usd      = var.prod_budget_usd
  kill_switch_enabled    = var.kill_switch_enabled
  kill_switch_service    = var.kill_switch_enabled ? module.prod.service_name : null
  kill_switch_runtime_sa = var.kill_switch_enabled ? module.prod.runtime_email : null

  depends_on = [google_project_service.prod_billingbudgets]
}
