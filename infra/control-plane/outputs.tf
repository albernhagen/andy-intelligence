output "service_url" {
  value = google_cloud_run_v2_service.control_plane.uri
}

output "image_repository" {
  description = "Set as the GitHub Actions variable GCP_IMAGE_REPO."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "deployer_service_account" {
  description = "Set as the GitHub Actions variable GCP_DEPLOYER_SA."
  value       = google_service_account.deployer.email
}
