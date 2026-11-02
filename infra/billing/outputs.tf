output "budget_name" {
  description = "Budget resource name (contains the billing account ID; don't paste it anywhere public)."
  value       = google_billing_budget.control_plane.name
  sensitive   = true
}

output "budget_amount_usd" {
  value = var.budget_amount_usd
}

output "kill_switch_topic" {
  description = "Topic the budget publishes to; publish a fake message here to test the switch (billing runbook §4)."
  value       = var.kill_switch_enabled ? google_pubsub_topic.budget[0].id : null
}
