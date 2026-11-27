# Plan-only tests with a mocked google provider (AI-201: M6.16): no credentials, no cloud calls.
# Run: terraform -chdir=infra/modules/project-env init -backend=false && terraform -chdir=infra/modules/project-env test

mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
  mock_resource "google_iam_workload_identity_pool" {
    override_during = plan
    defaults = {
      name = "projects/123456789012/locations/global/workloadIdentityPools/github"
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

# Every other service account shares the mock's email; the main deployer gets its own, so a grant
# that names the wrong identity fails.
override_resource {
  target          = google_service_account.deployer
  override_during = plan
  values = {
    name  = "projects/example-prod-000000/serviceAccounts/example-deploy@example-prod-000000.iam.gserviceaccount.com"
    email = "example-deploy@example-prod-000000.iam.gserviceaccount.com"
  }
}

variables {
  project_id            = "example-prod-000000"
  service_name          = "example"
  github_repository     = "example-owner/example-app"
  github_repository_id  = "123456789"
  alert_email           = "alerts@example.com"
  runtime_project_roles = ["roles/datastore.user"]
}

run "given_defaults_when_planned_then_main_deployer_bound_only_to_deploy_and_release_on_main" {
  command = plan

  assert {
    condition = toset([for b in google_service_account_iam_member.deployer_wif : b.member]) == toset([
      "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/github/attribute.workflow_ref/example-owner/example-app/.github/workflows/deploy.yml@refs/heads/main",
      "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/github/attribute.workflow_ref/example-owner/example-app/.github/workflows/release.yml@refs/heads/main",
    ])
    error_message = "The main deployer must federate only from deploy.yml and release.yml on refs/heads/main."
  }
  assert {
    condition     = google_iam_workload_identity_pool_provider.github.attribute_condition == "assertion.repository == 'example-owner/example-app' && assertion.repository_id == '123456789'"
    error_message = "The provider must accept tokens from the one repo, pinned by name and ID."
  }
}

run "given_defaults_when_planned_then_preview_deployer_bound_to_pull_request_on_preview_only" {
  command = plan

  assert {
    condition     = google_service_account_iam_member.preview_deployer_wif[0].member == "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/github/attribute.event_name/pull_request"
    error_message = "The preview deployer must federate only from pull_request runs."
  }
  assert {
    condition     = google_cloud_run_v2_service_iam_member.preview_deployer_run[0].name == "example-preview"
    error_message = "The preview deployer's run.developer must be on the preview service only."
  }
  assert {
    condition     = google_artifact_registry_repository_iam_member.preview_deployer_push[0].repository == "example-preview"
    error_message = "The preview deployer must push only to the preview repo."
  }
  assert {
    condition     = google_cloud_run_v2_service_iam_member.deployer_run.name == "example"
    error_message = "The main deployer's run.developer must be on the main service."
  }
}

run "given_runtime_roles_when_planned_then_preview_runtime_gets_none_of_them" {
  command = plan

  assert {
    condition     = contains(keys(google_project_iam_member.runtime), "roles/datastore.user")
    error_message = "The main runtime identity should get runtime_project_roles."
  }
  assert {
    condition     = toset(keys(google_project_iam_member.preview_runtime)) == toset(["roles/logging.logWriter", "roles/cloudtrace.agent"])
    error_message = "The preview runtime identity must get logs and traces only."
  }
}

run "given_defaults_when_planned_then_services_are_capped_and_scale_to_zero" {
  command = plan

  assert {
    condition     = google_cloud_run_v2_service.main.template[0].scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.main.template[0].scaling[0].max_instance_count == 2
    error_message = "The main service must scale to zero with at most 2 instances."
  }
  assert {
    condition     = google_cloud_run_v2_service.preview[0].template[0].scaling[0].max_instance_count == 1
    error_message = "The preview service must be capped at 1 instance."
  }
  assert {
    condition     = google_cloud_run_v2_service.main.template[0].timeout == "60s" && google_cloud_run_v2_service.main.template[0].max_instance_request_concurrency == 80
    error_message = "The main service must cap timeout and concurrency."
  }
  assert {
    condition     = length(google_monitoring_alert_policy.usage) == 6
    error_message = "All six M1.15 usage alerts should be planned."
  }
}

run "given_defaults_when_planned_then_main_is_public_preview_is_private_and_releases_are_kept" {
  command = plan

  assert {
    condition     = google_cloud_run_v2_service.main.invoker_iam_disabled == true && google_cloud_run_v2_service.preview[0].invoker_iam_disabled == false
    error_message = "The main service should skip Cloud Run IAM (safe-deploy smoke tests call it without a token); the preview must keep it."
  }
  assert {
    condition     = contains([for p in google_artifact_registry_repository.images["example"].cleanup_policies : p.id], "keep-tagged-releases")
    error_message = "Images tagged release-* must be kept by the cleanup policy."
  }
}

run "given_preview_disabled_when_planned_then_no_preview_resources" {
  command = plan

  variables {
    preview_enabled = false
  }

  assert {
    condition     = length(google_cloud_run_v2_service.preview) == 0 && length(google_service_account.preview_deployer) == 0 && length(google_artifact_registry_repository.images) == 1
    error_message = "preview_enabled = false should plan no preview service, deployer or repo."
  }
}

run "given_promote_from_dev_when_planned_then_service_agent_reads_that_repo_only" {
  command = plan

  variables {
    promote_source_repository = {
      project_id = "example-dev-000000"
      location   = "us-central1"
      repository = "example"
    }
  }

  assert {
    condition     = google_artifact_registry_repository_iam_member.promote_source_read[0].project == "example-dev-000000" && google_artifact_registry_repository_iam_member.promote_source_read[0].role == "roles/artifactregistry.reader" && google_artifact_registry_repository_iam_member.promote_source_read[0].member == "serviceAccount:service-123456789012@serverless-robot-prod.iam.gserviceaccount.com"
    error_message = "Promote should give only this project's Cloud Run service agent read on the dev repo."
  }
  assert {
    condition     = google_artifact_registry_repository_iam_member.promote_source_tag[0].project == "example-dev-000000" && google_artifact_registry_repository_iam_member.promote_source_tag[0].repository == "example" && google_artifact_registry_repository_iam_member.promote_source_tag[0].role == "roles/artifactregistry.writer" && google_artifact_registry_repository_iam_member.promote_source_tag[0].member == "serviceAccount:example-deploy@example-prod-000000.iam.gserviceaccount.com"
    error_message = "Promote should give the main deployer write on the dev repo only, to check the digest (AI-390) and tag it release-* (AI-389)."
  }
}

run "given_no_promote_source_when_planned_then_no_cross_project_access" {
  command = plan

  assert {
    condition     = length(google_artifact_registry_repository_iam_member.promote_source_read) == 0 && length(google_artifact_registry_repository_iam_member.promote_source_tag) == 0
    error_message = "Without promote_source_repository, nothing should reach another project's registry."
  }
}

run "given_a_runtime_role_of_owner_when_planned_then_rejected" {
  command = plan

  variables {
    runtime_project_roles = ["roles/owner"]
  }

  expect_failures = [var.runtime_project_roles]
}

run "given_a_workflow_path_when_planned_then_rejected" {
  command = plan

  variables {
    main_deployer_workflows = ["../../evil.yml"]
  }

  expect_failures = [var.main_deployer_workflows]
}

run "given_defaults_when_planned_then_prod_gets_an_uptime_and_a_5xx_alert" {
  command = plan

  assert {
    condition     = length(module.prod_alerts) == 1 && length(output.alert_policy_names) == 2
    error_message = "A public prod service gets the uptime alert and the 5xx alert (AI-209: M6.19)."
  }
}

run "given_cloud_run_iam_on_when_planned_then_only_the_5xx_alert" {
  command = plan

  variables {
    allow_unauthenticated = false
  }

  assert {
    condition     = length(output.alert_policy_names) == 1
    error_message = "The uptime check sends no identity token, so a service behind Cloud Run IAM gets the 5xx alert only."
  }
}

run "given_prod_alerts_disabled_when_planned_then_no_prod_alerts" {
  command = plan

  variables {
    prod_alerts_enabled = false
  }

  assert {
    condition     = length(module.prod_alerts) == 0 && length(output.alert_policy_names) == 0
    error_message = "A dev environment turns prod alerts off."
  }
}
