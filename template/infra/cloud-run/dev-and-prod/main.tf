# Deploy environments for this project: `cloud-run` deploy kind, `dev-and-prod` (ADR-0114; seeded
# by the andy-intelligence baseline, AI-109: M6.22). Two environments, <app>-dev (first: deploys on
# push to main, PR previews) and <app>-prod (promote ships dev's image digest), each with a monthly
# budget. This file is the project's own once written: the baseline never rewrites it. Nothing in
# CI applies it; Andy applies it locally (andy-intelligence runbook docs/runbooks/project-env.md).
# Real IDs go in the gitignored terraform.tfvars, never here.

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

# One provider per environment. The Budget API needs a quota project with user credentials
# (user_project_override), or it returns 403; each environment's own project is its quota project.
provider "google" {
  alias                 = "dev"
  project               = var.dev_project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.dev_project_id
}

provider "google" {
  alias                 = "prod"
  project               = var.prod_project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.prod_project_id
}

module "dev" {
  source    = "../../../../infra/modules/project-env"
  providers = { google = google.dev }

  project_id            = var.dev_project_id
  region                = var.region
  service_name          = var.service_name
  github_repository     = var.github_repository
  github_repository_id  = var.github_repository_id
  alert_email           = var.alert_email
  runtime_project_roles = var.runtime_project_roles
  preview_enabled       = true
  # Uptime and 5xx alerts are for prod only (AI-209: M6.19).
  prod_alerts_enabled = false
}

module "prod" {
  source    = "../../../../infra/modules/project-env"
  providers = { google = google.prod }

  project_id            = var.prod_project_id
  region                = var.region
  service_name          = var.service_name
  github_repository     = var.github_repository
  github_repository_id  = var.github_repository_id
  alert_email           = var.alert_email
  runtime_project_roles = var.runtime_project_roles
  # Previews run only in the first environment; promote ships dev's image by digest.
  preview_enabled = false
  promote_source_repository = {
    project_id = var.dev_project_id
    location   = var.region
    repository = var.service_name
  }

  depends_on = [module.dev]
}

resource "google_project_service" "dev_billingbudgets" {
  provider           = google.dev
  project            = var.dev_project_id
  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "prod_billingbudgets" {
  provider           = google.prod
  project            = var.prod_project_id
  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
}

module "dev_budget" {
  source    = "../../../../infra/modules/project-budget"
  providers = { google = google.dev }

  billing_account_id     = var.billing_account_id
  project_id             = var.dev_project_id
  region                 = var.region
  budget_amount_usd      = var.dev_budget_usd
  kill_switch_enabled    = var.kill_switch_enabled
  kill_switch_service    = var.kill_switch_enabled ? module.dev.service_name : null
  kill_switch_runtime_sa = var.kill_switch_enabled ? module.dev.runtime_email : null

  depends_on = [google_project_service.dev_billingbudgets]
}

module "prod_budget" {
  source    = "../../../../infra/modules/project-budget"
  providers = { google = google.prod }

  billing_account_id     = var.billing_account_id
  project_id             = var.prod_project_id
  region                 = var.region
  budget_amount_usd      = var.prod_budget_usd
  kill_switch_enabled    = var.kill_switch_enabled
  kill_switch_service    = var.kill_switch_enabled ? module.prod.service_name : null
  kill_switch_runtime_sa = var.kill_switch_enabled ? module.prod.runtime_email : null

  depends_on = [google_project_service.prod_billingbudgets]
}
