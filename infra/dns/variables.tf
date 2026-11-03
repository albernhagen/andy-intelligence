variable "zone_id" {
  type        = string
  description = "Cloudflare zone ID of apex_domain (dashboard → the domain → Overview → API). Set in the gitignored terraform.tfvars."
}

variable "apex_domain" {
  type    = string
  default = "andybernhagen.com"
}

variable "custom_domain" {
  type        = string
  description = "Must match custom_domain in infra/control-plane."
  default     = "ai.andybernhagen.com"
}

variable "google_site_verification" {
  type        = string
  description = "The token Search Console shows for a Domain property (the part after google-site-verification=). Set in the gitignored terraform.tfvars."

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]+$", var.google_site_verification))
    error_message = "Paste only the token, without the google-site-verification= prefix or quotes."
  }
}
