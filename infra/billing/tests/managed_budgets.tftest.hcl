# Plan-only tests with a mocked google provider (AI-162: M6.14): no credentials, no cloud calls.
# Run: terraform -chdir=infra/billing init -backend=false && terraform -chdir=infra/billing test

mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
}

variables {
  billing_account_id = "000000-AAAAAA-BBBBBB"
}

run "given_no_managed_projects_when_planned_then_no_managed_budgets" {
  command = plan

  assert {
    condition     = length(module.managed_project_budget) == 0
    error_message = "No managed_projects should plan no managed budgets."
  }
}

run "given_two_managed_projects_when_planned_then_one_budget_each" {
  command = plan

  variables {
    managed_projects = {
      "example-dev" = { project_id = "example-dev-000000" }
      "example-prod" = {
        project_id             = "example-prod-000000"
        kill_switch_enabled    = true
        kill_switch_service    = "example"
        kill_switch_runtime_sa = "example-runtime@example-prod-000000.iam.gserviceaccount.com"
      }
    }
  }

  assert {
    condition     = length(module.managed_project_budget) == 2
    error_message = "Each managed project should get exactly one budget module."
  }
  assert {
    condition     = module.managed_project_budget["example-dev"].kill_switch_topic == null
    error_message = "The kill switch should stay off unless an entry turns it on."
  }
}

run "given_the_control_plane_project_when_listed_as_managed_then_rejected" {
  command = plan

  variables {
    managed_projects = {
      "self" = { project_id = "andy-intelligence-512400" }
    }
  }

  expect_failures = [var.managed_projects]
}

run "given_module_with_kill_switch_off_when_planned_then_thresholds_and_no_kill_switch" {
  command = plan

  module {
    source = "../modules/project-budget"
  }

  variables {
    project_id = "example-dev-000000"
  }

  assert {
    condition = [for r in google_billing_budget.this.threshold_rules : [r.threshold_percent, coalesce(r.spend_basis, "CURRENT_SPEND")]] == [
      [0.5, "CURRENT_SPEND"], [0.9, "CURRENT_SPEND"], [1.0, "CURRENT_SPEND"], [1.5, "CURRENT_SPEND"], [1.0, "FORECASTED_SPEND"],
    ]
    error_message = "Thresholds should be 50%, 90%, 100%, 150% actual and 100% forecast, in that order."
  }
  assert {
    condition     = google_billing_budget.this.amount[0].specified_amount[0].units == "10"
    error_message = "The default budget should be $10/month."
  }
  assert {
    condition     = google_billing_budget.this.budget_filter[0].projects == toset(["projects/123456789012"])
    error_message = "The budget should track only its own project, by number."
  }
  assert {
    condition = (length(google_project_service.kill_switch) + length(google_pubsub_topic.budget)
      + length(google_pubsub_topic_iam_member.billing_publishes) + length(google_service_account.kill_switch)
      + length(google_project_iam_custom_role.kill_switch_run) + length(google_project_iam_custom_role.kill_switch_project)
      + length(google_cloud_run_v2_service_iam_member.kill_switch_run) + length(google_project_iam_member.kill_switch)
      + length(google_service_account_iam_member.kill_switch_acts_as_runtime) + length(google_workflows_workflow.kill_switch)
    + length(google_eventarc_trigger.kill_switch)) == 0
    error_message = "With the kill switch off, the module should create no kill switch resources."
  }
  assert {
    condition     = length(google_billing_budget.this.all_updates_rule) == 0
    error_message = "With the kill switch off, the budget should not publish to a topic."
  }
}

run "given_module_with_kill_switch_on_when_planned_then_wired_to_the_switch" {
  command = plan

  module {
    source = "../modules/project-budget"
  }

  variables {
    project_id             = "example-prod-000000"
    kill_switch_enabled    = true
    kill_switch_service    = "example"
    kill_switch_runtime_sa = "example-runtime@example-prod-000000.iam.gserviceaccount.com"
  }

  assert {
    condition     = length(google_billing_budget.this.all_updates_rule) == 1
    error_message = "With the kill switch on, the budget should publish to the kill switch topic."
  }
  assert {
    condition     = length(google_workflows_workflow.kill_switch) == 1 && length(google_eventarc_trigger.kill_switch) == 1
    error_message = "With the kill switch on, the workflow and its trigger should exist."
  }
  assert {
    condition     = google_workflows_workflow.kill_switch[0].project == "example-prod-000000" && google_workflows_workflow.kill_switch[0].user_env_vars["SERVICE"] == "example"
    error_message = "The workflow should run in the managed project and stop its service."
  }
  assert {
    condition     = google_cloud_run_v2_service_iam_member.kill_switch_run[0].name == "example"
    error_message = "The Cloud Run grant should be on the one service only."
  }
}

run "given_module_with_kill_switch_on_and_no_service_when_planned_then_rejected" {
  command = plan

  module {
    source = "../modules/project-budget"
  }

  variables {
    project_id          = "example-prod-000000"
    kill_switch_enabled = true
  }

  expect_failures = [var.kill_switch_service, var.kill_switch_runtime_sa]
}
