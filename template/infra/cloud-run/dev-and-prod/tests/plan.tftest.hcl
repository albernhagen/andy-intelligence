# Plans this root with the example values and mocked google providers (AI-109: M6.22): no
# credentials, no cloud calls. CI runs it (baseline terraform-check: terraform test).

mock_provider "google" {
  alias = "dev"
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
  mock_resource "google_iam_workload_identity_pool_provider" {
    override_during = plan
    defaults = {
      name = "projects/123456789012/locations/global/workloadIdentityPools/github/providers/github-actions"
    }
  }
  mock_resource "google_service_account" {
    override_during = plan
    defaults = {
      name  = "projects/example-dev-000000/serviceAccounts/sa@example-dev-000000.iam.gserviceaccount.com"
      email = "sa@example-dev-000000.iam.gserviceaccount.com"
    }
  }
}

mock_provider "google" {
  alias = "prod"
  mock_data "google_project" {
    defaults = {
      number = "210987654321"
    }
  }
  mock_resource "google_iam_workload_identity_pool_provider" {
    override_during = plan
    defaults = {
      name = "projects/210987654321/locations/global/workloadIdentityPools/github/providers/github-actions"
    }
  }
  mock_resource "google_service_account" {
    override_during = plan
    defaults = {
      name  = "projects/example-prod-000000/serviceAccounts/sa@example-prod-000000.iam.gserviceaccount.com"
      email = "sa@example-prod-000000.iam.gserviceaccount.com"
    }
  }
}

# Same values as terraform.tfvars.example.
variables {
  dev_project_id       = "example-dev-000000"
  prod_project_id      = "example-prod-000000"
  service_name         = "example"
  github_repository    = "example-owner/example-app"
  github_repository_id = "123456789"
  alert_email          = "alerts@example.com"
  billing_account_id   = "000000-000000-000000"
}

run "given_example_values_when_planned_then_two_environments_each_with_a_budget" {
  command = plan

  assert {
    condition     = module.dev.preview_service_name == "example-preview" && module.prod.preview_service_name == null
    error_message = "Only dev, the first environment, gets PR previews."
  }
  assert {
    condition     = length(module.dev.alert_policy_names) == 0 && length(module.prod.alert_policy_names) == 2
    error_message = "Only prod gets the uptime and 5xx alerts (AI-209: M6.19)."
  }
  assert {
    condition = (
      google_project_service.dev_billingbudgets.project == "example-dev-000000" &&
      google_project_service.prod_billingbudgets.project == "example-prod-000000"
    )
    error_message = "Each environment's budget needs the Budget API on in its own project."
  }
}

run "given_example_values_when_planned_then_outputs_name_every_deploy_caller_variable" {
  command = plan

  assert {
    condition = toset(keys(output.repo_variables)) == toset([
      "GCP_DEV_PROJECT_ID", "GCP_DEV_REGION", "GCP_DEV_SERVICE", "GCP_DEV_SERVICE_URL",
      "GCP_DEV_WIF_PROVIDER", "GCP_DEV_DEPLOYER_SA", "GCP_DEV_IMAGE_REPO",
      "GCP_DEV_PREVIEW_SERVICE", "GCP_DEV_PREVIEW_DEPLOYER_SA", "GCP_DEV_PREVIEW_IMAGE_REPO",
      "GCP_PROJECT_ID", "GCP_REGION", "GCP_SERVICE", "GCP_SERVICE_URL", "GCP_WIF_PROVIDER",
      "GCP_DEPLOYER_SA", "GCP_IMAGE_REPO", "DEPLOY_SMOKE_CHECKS",
    ])
    error_message = "repo_variables must name every variable deploy.yml, release.yml and preview.yml read."
  }
}

run "given_the_kill_switch_on_when_planned_then_both_environments_plan" {
  command = plan

  variables {
    kill_switch_enabled = true
  }

  assert {
    condition     = output.repo_variables.GCP_DEV_SERVICE == "example"
    error_message = "The root should plan with the kill switch on."
  }
}

run "given_two_smoke_checks_when_planned_then_the_output_keeps_both_lines" {
  command = plan

  variables {
    smoke_checks = "/health 200\n/ready 200,204"
  }

  assert {
    condition     = output.repo_variables.DEPLOY_SMOKE_CHECKS == "/health 200\n/ready 200,204"
    error_message = "DEPLOY_SMOKE_CHECKS must keep one check per line."
  }
}
