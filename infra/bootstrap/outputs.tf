output "state_bucket" {
  value = google_storage_bucket.tfstate.name
}

output "workload_identity_provider" {
  description = "Set as the GitHub Actions variable GCP_WIF_PROVIDER."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "workload_identity_pool" {
  value = google_iam_workload_identity_pool.github.name
}

output "tf_plan_service_account" {
  description = "Set as the GitHub Actions variable GCP_TF_PLAN_SA."
  value       = google_service_account.tf_plan.email
}
