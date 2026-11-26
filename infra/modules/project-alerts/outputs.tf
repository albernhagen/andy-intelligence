output "uptime_check_id" {
  description = "Uptime check ID; null when uptime_check_enabled is off."
  value       = var.uptime_check_enabled ? google_monitoring_uptime_check_config.health[0].uptime_check_id : null
}

output "alert_policy_names" {
  description = "Resource names of the alert policies this module created."
  value       = concat([for p in google_monitoring_alert_policy.uptime : p.name], [google_monitoring_alert_policy.errors.name])
}
