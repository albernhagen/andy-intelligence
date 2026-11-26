variable "project_id" {
  type        = string
  description = "Existing GCP project for this environment (e.g. <app>-prod). Nothing here creates projects."

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a GCP project ID: 6 to 30 lowercase letters, digits or hyphens."
  }
}

variable "region" {
  type        = string
  description = "Region of the Cloud Run services and the Artifact Registry repos."
  default     = "us-central1"
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name; the preview service is <service_name>-preview, the registry repo <service_name>."

  validation {
    # Leaves room for the longest service account ID suffix ("-pr-deploy") in the 30-character limit.
    condition     = can(regex("^[a-z][a-z0-9-]{0,16}[a-z0-9]$", var.service_name))
    error_message = "service_name must be 2 to 18 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "github_repository" {
  type        = string
  description = "owner/name of the managed repo whose workflows deploy here, in GitHub's exact case (it is matched against the OIDC token)."

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "github_repository must be owner/name."
  }
}

variable "github_repository_id" {
  type        = string
  description = "Numeric GitHub repository ID (`gh api repos/OWNER/NAME --jq .id`). A deleted and re-created repo of the same name gets a new ID, so it can't federate."

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id must be the repo's numeric ID."
  }
}

variable "main_deployer_workflows" {
  type        = list(string)
  description = "Workflow files on refs/heads/main that may act as the main deployer (ADR-0114: deploy.yml on push, release.yml on workflow_dispatch)."
  default     = ["deploy.yml", "release.yml"]

  validation {
    condition     = length(var.main_deployer_workflows) > 0 && alltrue([for w in var.main_deployer_workflows : can(regex("^[A-Za-z0-9._-]+\\.ya?ml$", w))])
    error_message = "main_deployer_workflows must list one or more workflow file names (e.g. deploy.yml), no paths."
  }
}

variable "wif_pool_id" {
  type        = string
  description = "Workload Identity pool ID created in project_id. A deleted pool keeps its ID for 30 days."
  default     = "github"
}

variable "preview_enabled" {
  type        = bool
  description = "Create the <service>-preview service, its registry repo and the preview deployer (ADR-0114: only in the first environment's project)."
  default     = true
}

variable "allow_unauthenticated" {
  type        = bool
  description = "Serve the main service without Cloud Run IAM: a public app doing its own auth, like the control plane. On by default because cloud-run-safe-deploy's smoke tests and the verify task call the service without an identity token (ADR-0076, ADR-0114). Off: callers need run.invoker, and those calls fail."
  default     = true
}

variable "preview_allow_unauthenticated" {
  type        = bool
  description = "Same for the preview service, which runs unmerged PR code. Off by default."
  default     = false
}

variable "max_instances" {
  type        = number
  description = "Cost cap (ADR-0028): most instances of the main service."
  default     = 2

  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 10
    error_message = "max_instances must be 1 to 10; raise the cap in the module, with a reason, if you need more."
  }
}

variable "preview_max_instances" {
  type        = number
  description = "Cost cap (ADR-0028): most instances of the preview service, across all PR revisions."
  default     = 1

  validation {
    condition     = var.preview_max_instances >= 1 && var.preview_max_instances <= 3
    error_message = "preview_max_instances must be 1 to 3."
  }
}

variable "concurrency" {
  type        = number
  description = "Cost cap (ADR-0028): requests per instance."
  default     = 80

  validation {
    condition     = var.concurrency >= 1 && var.concurrency <= 1000
    error_message = "concurrency must be 1 to 1000."
  }
}

variable "request_timeout_seconds" {
  type        = number
  description = "Cost cap (ADR-0028): billed time per request."
  default     = 60

  validation {
    condition     = var.request_timeout_seconds >= 1 && var.request_timeout_seconds <= 300
    error_message = "request_timeout_seconds must be 1 to 300."
  }
}

variable "cpu" {
  type        = string
  description = "CPU limit per instance."
  default     = "1"
}

variable "memory" {
  type        = string
  description = "Memory limit per instance."
  default     = "512Mi"
}

variable "runtime_project_roles" {
  type        = list(string)
  description = "Extra project roles for the main service's runtime identity only (e.g. roles/datastore.user). The preview identity never gets them."
  default     = []

  validation {
    condition     = alltrue([for r in var.runtime_project_roles : !contains(["roles/owner", "roles/editor"], r) && !startswith(r, "roles/iam.") && !startswith(r, "roles/resourcemanager.") && !endswith(r, ".admin")])
    error_message = "runtime_project_roles can't hold owner, editor, iam.*, resourcemanager.* or *.admin roles."
  }
}

variable "promote_source_repository" {
  type = object({
    project_id = string
    location   = string
    repository = string
  })
  description = "dev-and-prod only, on the prod environment: the dev registry repo promote ships from (ADR-0114: same image digest). Gives this project's Cloud Run service agent read, and its main deployer write (to tag release-*: AI-389), on that one repo. Null otherwise."
  default     = null
}

variable "image_keep_count" {
  type        = number
  description = "Registry cleanup: the newest versions always kept in each repo."
  default     = 10
}

variable "image_keep_tag_prefixes" {
  type        = list(string)
  description = "Registry cleanup: versions with a tag starting with one of these are never deleted. The baseline deploy.yml (prod-only) and release.yml (promote) tag what prod runs release-<digest hex> (AI-389), so a later rollback or cold start can still pull it."
  default     = ["release-"]
}

variable "image_max_age_days" {
  type        = number
  description = "Registry cleanup: older versions than this are deleted, except the newest image_keep_count."
  default     = 30
}

variable "log_exclusion_paths" {
  type        = list(string)
  description = "URL substrings whose successful (< 400) request logs are dropped for both services. Errors always log."
  default     = ["/health", "/assets/"]
}

variable "alert_email" {
  type        = string
  description = "Where usage alerts go. Personal data: keep it out of the repo (gitignored tfvars or TF_VAR_alert_email)."
  sensitive   = true
}

variable "usage_alert_thresholds" {
  type = object({
    run_requests_per_5m       = optional(number, 3000)
    run_sent_bytes_per_hour   = optional(number, 1073741824) # 1 GiB
    firestore_reads_per_hour  = optional(number, 20000)
    firestore_writes_per_hour = optional(number, 10000)     # applies to writes and to deletes
    log_bytes_per_hour        = optional(number, 524288000) # 500 MiB
  })
  description = "M1.15 usage alerts, same defaults as infra/control-plane. Firestore alerts never fire in a project without Firestore."
  default     = {}
}
