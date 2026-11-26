output "workload_identity_provider" {
  description = "For google-github-actions/auth `workload_identity_provider` in deploy.yml, release.yml and the preview workflow."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_email" {
  description = "Main deployer (deploy.yml, release.yml on main): `service_account` for google-github-actions/auth."
  value       = google_service_account.deployer.email
}

output "preview_deployer_email" {
  description = "Preview deployer (same-repo pull_request runs); null without previews."
  value       = var.preview_enabled ? google_service_account.preview_deployer[0].email : null
}

output "service_name" {
  description = "Main Cloud Run service."
  value       = google_cloud_run_v2_service.main.name
}

output "service_url" {
  description = "Main service URL (the Deployment record's `url` where verification runs)."
  value       = google_cloud_run_v2_service.main.uri
}

output "preview_service_name" {
  description = "Preview Cloud Run service; null without previews."
  value       = var.preview_enabled ? google_cloud_run_v2_service.preview[0].name : null
}

output "runtime_email" {
  description = "Main service's runtime identity (project-budget's kill_switch_runtime_sa)."
  value       = google_service_account.runtime.email
}

output "image_repository" {
  description = "Where deploy.yml pushes: <region>-docker.pkg.dev/<project>/<service>."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images[var.service_name].repository_id}"
}

output "preview_image_repository" {
  description = "Where the preview workflow pushes; null without previews."
  value       = var.preview_enabled ? "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images[local.preview_name].repository_id}" : null
}
