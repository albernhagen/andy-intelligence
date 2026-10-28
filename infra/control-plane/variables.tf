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

