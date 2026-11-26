variable "project_id" {
  type        = string
  description = "GCP project of the prod service; the uptime check and policies live here."

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a GCP project ID: 6 to 30 lowercase letters, digits or hyphens."
  }
}

variable "service_name" {
  type        = string
  description = "Cloud Run service whose 5xx responses are counted."

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,47}[a-z0-9]$", var.service_name))
    error_message = "service_name must be a Cloud Run service name."
  }
}

variable "service_host" {
  type        = string
  description = "Host the uptime check calls over HTTPS, no scheme or path (e.g. the run.app host or a custom domain)."

  validation {
    condition     = can(regex("^[A-Za-z0-9.-]+$", var.service_host))
    error_message = "service_host must be a bare host name: no scheme, port or path."
  }
}

variable "health_path" {
  type        = string
  description = "Path the uptime check expects a 2xx from."
  default     = "/health"

  validation {
    condition     = startswith(var.health_path, "/")
    error_message = "health_path must start with /."
  }
}

variable "uptime_check_enabled" {
  type        = bool
  description = "Create the uptime check and its alert. Off for a service behind Cloud Run IAM: the check sends no identity token, so it would always fail."
  default     = true
}

variable "notification_channel_ids" {
  type        = list(string)
  description = "Monitoring notification channel IDs both alerts go to (project-env passes its alert_email channel). IDs only: no addresses here."

  validation {
    condition     = length(var.notification_channel_ids) >= 1 && length(var.notification_channel_ids) <= 5
    error_message = "notification_channel_ids must list 1 to 5 channels."
  }
}

variable "error_threshold_per_5m" {
  type        = number
  description = "Alert when the service returns more than this many 5xx responses in 5 minutes."
  default     = 5

  validation {
    condition     = var.error_threshold_per_5m >= 1 && var.error_threshold_per_5m <= 1000
    error_message = "error_threshold_per_5m must be 1 to 1000."
  }
}
