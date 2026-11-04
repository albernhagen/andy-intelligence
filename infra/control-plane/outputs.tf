# The custom domain (ADR-0044): the only authorized sign-in domain, OAuth issuer and OIDC audience.
output "service_url" {
  value = local.public_url
}

output "domain_mapping_records" {
  description = "DNS records Cloud Run expects (infra/dns creates them)."
  value       = try(google_cloud_run_domain_mapping.public.status[0].resource_records, [])
}

output "image_repository" {
  description = "Set as the GitHub Actions variable GCP_IMAGE_REPO."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "deployer_service_account" {
  description = "Set as the GitHub Actions variable GCP_DEPLOYER_SA."
  value       = google_service_account.deployer.email
}

output "run_watchdog_queue" {
  description = "Cloud Tasks queue for run deadlines (M1.6: Claude Code executor)."
  value       = google_cloud_tasks_queue.run_watchdog.id
}

output "tasks_invoker_service_account" {
  value = google_service_account.tasks_invoker.email
}
