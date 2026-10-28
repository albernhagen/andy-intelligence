variable "project_id" {
  type    = string
  default = "andy-intelligence-512400"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "github_owner" {
  type    = string
  default = "albernhagen"
}

variable "github_repo" {
  type    = string
  default = "andy-intelligence"
}

variable "allowed_emails" {
  type        = list(string)
  description = "Google accounts allowed to use the UI/API/MCP. Never committed: set via gitignored terraform.tfvars locally or the TF_VAR_ALLOWED_EMAILS Actions secret."
  sensitive   = true
}

variable "alert_email" {
  type        = string
  description = "Email for usage alerts (M1.15: Usage alerts). Never committed: set via gitignored terraform.tfvars locally or the TF_VAR_ALERT_EMAIL Actions secret."
  sensitive   = true

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must be an email address."
  }
}

variable "usage_alert_thresholds" {
  type = object({
    run_requests_per_5m       = optional(number, 3000)
    run_sent_bytes_per_hour   = optional(number, 1073741824) # 1 GiB
    firestore_reads_per_hour  = optional(number, 20000)
    firestore_writes_per_hour = optional(number, 10000)     # applies to writes and to deletes
    log_bytes_per_hour        = optional(number, 524288000) # 500 MiB
  })
  description = "Usage alert thresholds. Override one at a time, e.g. -var 'usage_alert_thresholds={run_requests_per_5m=0}'."
  default     = {}
}

