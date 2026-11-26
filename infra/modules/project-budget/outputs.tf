output "budget_name" {
  description = "Budget resource name (contains the billing account ID; don't paste it anywhere public)."
  value       = google_billing_budget.this.name
  sensitive   = true
}

output "kill_switch_topic" {
  description = "Topic the budget publishes to when the kill switch is on; publish a fake message here to test it (billing runbook §8)."
  value       = var.kill_switch_enabled ? google_pubsub_topic.budget[0].id : null
}
