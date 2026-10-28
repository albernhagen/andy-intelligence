variable "project_id" {
  type        = string
  description = "Control-plane GCP project ID."
  default     = "andy-intelligence-512400"
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
