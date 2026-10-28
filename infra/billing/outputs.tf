output "budget_name" {
  description = "Budget resource name (contains the billing account ID; don't paste it anywhere public)."
  value       = google_billing_budget.control_plane.name
  sensitive   = true
}

output "budget_amount_usd" {
  value = var.budget_amount_usd
}
