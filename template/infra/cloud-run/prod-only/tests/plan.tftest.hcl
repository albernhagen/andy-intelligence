# Plans this root with the example values and a mocked google provider (AI-109: M6.22): no
# credentials, no cloud calls. CI runs it (baseline terraform-check: terraform test).

mock_provider "google" {
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
      name  = "projects/example-prod-000000/serviceAccounts/sa@example-prod-000000.iam.gserviceaccount.com"
      email = "sa@example-prod-000000.iam.gserviceaccount.com"
    }
  }
}

# Same values as terraform.tfvars.example.
variables {
  prod_project_id      = "example-prod-000000"
  service_name         = "example"
  github_repository    = "example-owner/example-app"
  github_repository_id = "123456789"
  alert_email          = "alerts@example.com"
  billing_account_id   = "000000-000000-000000"
}

run "given_example_values_when_planned_then_one_environment_with_previews_and_a_budget" {
  command = plan

  assert {
    condition     = module.prod.preview_service_name == "example-preview"
    error_message = "prod is the first environment, so it gets PR previews."
  }
  assert {
    condition     = google_project_service.prod_billingbudgets.project == "example-prod-000000"
    error_message = "prod's budget needs the Budget API on in prod."
  }
}

run "given_example_values_when_planned_then_outputs_name_every_deploy_caller_variable" {
  command = plan

  assert {
    condition = toset(keys(output.repo_variables)) == toset([
      "GCP_PROJECT_ID", "GCP_REGION", "GCP_SERVICE", "GCP_SERVICE_URL", "GCP_WIF_PROVIDER",
      "GCP_DEPLOYER_SA", "GCP_IMAGE_REPO", "GCP_PREVIEW_SERVICE", "GCP_PREVIEW_DEPLOYER_SA",
      "GCP_PREVIEW_IMAGE_REPO", "DEPLOY_SMOKE_CHECKS",
    ])
    error_message = "repo_variables must name every variable deploy.yml, release.yml and preview.yml read."
  }
}

run "given_the_kill_switch_on_when_planned_then_it_targets_the_prod_service" {
  command = plan

  variables {
    kill_switch_enabled = true
  }

  assert {
    condition     = output.repo_variables.GCP_SERVICE == "example"
    error_message = "The root should plan with the kill switch on."
  }
}
