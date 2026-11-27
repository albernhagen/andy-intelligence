# Example root for infra/modules/project-env (AI-201: M6.16), with fake IDs. Never applied: CI
# validates it and runs tests/ as plan-only tests with a mocked provider (no credentials).
# A managed repo's template root (AI-109: M6.22) looks like this with real values in a
# gitignored tfvars and a gcs backend.

terraform {
  required_version = ">= 1.16, < 2.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.8"
    }
  }
}

variable "preview_enabled" {
  type    = bool
  default = true
}

variable "promote_from_dev" {
  type    = bool
  default = false
}

provider "google" {
  project = "example-prod-000000"
  region  = "us-central1"
}

module "env" {
  source = "../.."

  project_id            = "example-prod-000000"
  service_name          = "example"
  github_repository     = "example-owner/example-app"
  github_repository_id  = "123456789"
  alert_email           = "alerts@example.com"
  preview_enabled       = var.preview_enabled
  runtime_project_roles = ["roles/datastore.user"]
  promote_source_repository = var.promote_from_dev ? {
    project_id = "example-dev-000000"
    location   = "us-central1"
    repository = "example"
  } : null
}

output "workload_identity_provider" {
  value = module.env.workload_identity_provider
}
