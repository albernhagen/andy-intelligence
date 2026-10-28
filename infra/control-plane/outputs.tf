# Use this URL, not the service's legacy hash URL (control-plane-<hash>-uc.a.run.app):
# only this host is an authorized sign-in domain.
output "service_url" {
  value = "https://${local.service_host}"
}

output "image_repository" {
  description = "Set as the GitHub Actions variable GCP_IMAGE_REPO."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "deployer_service_account" {
  description = "Set as the GitHub Actions variable GCP_DEPLOYER_SA."
  value       = google_service_account.deployer.email
}
