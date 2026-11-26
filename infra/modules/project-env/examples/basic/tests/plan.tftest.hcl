# Plans the example root with fake IDs and a mocked google provider (AI-201: M6.16): no
# credentials, no cloud calls. The module's own assertions are in ../../tests/.

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
}

run "given_fake_ids_when_planned_then_the_example_root_plans" {
  command = plan

  assert {
    condition     = output.workload_identity_provider != null
    error_message = "The example root should plan the module and expose its provider."
  }
}

run "given_dev_and_prod_settings_when_planned_then_the_prod_example_plans" {
  command = plan

  variables {
    preview_enabled  = false
    promote_from_dev = true
  }

  assert {
    condition     = output.workload_identity_provider != null
    error_message = "The prod example (no previews, promote from dev) should plan."
  }
}
