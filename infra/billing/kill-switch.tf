# Cost kill switch (ADR-0028, M1.14: Cost kill switch). Opt-in: nothing here exists unless
# kill_switch_enabled = true. The budget publishes its status to a topic several times a day;
# a workflow takes the control plane offline once actual spend reaches kill_switch_ratio of the
# budget. It never disables billing (that can delete resources). Re-enable: billing runbook §4.
#
# Budget → Pub/Sub topic → Eventarc trigger → Workflow → Cloud Run (manual scaling, 0
# instances) + Cloud Tasks (pause every queue in the region).

locals {
  kill_switch     = var.kill_switch_enabled ? 1 : 0
  runtime_sa      = "control-plane-runtime@${var.project_id}.iam.gserviceaccount.com"
  kill_switch_api = ["eventarc.googleapis.com", "pubsub.googleapis.com", "workflows.googleapis.com"]
}

resource "google_project_service" "kill_switch" {
  for_each           = var.kill_switch_enabled ? toset(local.kill_switch_api) : toset([])
  service            = each.value
  disable_on_destroy = false
}

resource "google_pubsub_topic" "budget" {
  count = local.kill_switch
  name  = "budget-notifications"
  # Messages are only useful while fresh; a day covers a short outage of the trigger.
  message_retention_duration = "86400s"
  depends_on                 = [google_project_service.kill_switch]
}

# Cloud Billing publishes budget status as this Google-managed identity.
resource "google_pubsub_topic_iam_member" "billing_publishes" {
  count  = local.kill_switch
  topic  = google_pubsub_topic.budget[0].id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:billing-budget-alert@system.gserviceaccount.com"
}

# Runs the trigger and the workflow. Least privilege: a custom role with only what the
# workflow calls, plus actAs on the runtime SA (Cloud Run checks it on service updates).
resource "google_service_account" "kill_switch" {
  count        = local.kill_switch
  account_id   = "cost-kill-switch"
  display_name = "Cost kill switch (M1.14)"
}

resource "google_project_iam_custom_role" "kill_switch" {
  count       = local.kill_switch
  role_id     = "costKillSwitch"
  title       = "Cost kill switch"
  description = "Scale Cloud Run services to zero and pause Cloud Tasks queues (ADR-0028)."
  permissions = [
    "run.services.get",
    "run.services.update",
    "run.operations.get",
    "cloudtasks.queues.list",
    "cloudtasks.queues.pause",
  ]
}

resource "google_project_iam_member" "kill_switch" {
  for_each = var.kill_switch_enabled ? toset([
    google_project_iam_custom_role.kill_switch[0].name,
    "roles/workflows.invoker", # the Eventarc trigger starts the workflow as this SA
    "roles/logging.logWriter",
  ]) : toset([])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.kill_switch[0].email}"
}

resource "google_service_account_iam_member" "kill_switch_acts_as_runtime" {
  count              = local.kill_switch
  service_account_id = "projects/${var.project_id}/serviceAccounts/${local.runtime_sa}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.kill_switch[0].email}"
}

resource "google_workflows_workflow" "kill_switch" {
  count               = local.kill_switch
  name                = "cost-kill-switch"
  region              = var.region
  description         = "Takes the control plane offline at ${var.kill_switch_ratio * 100}% of budget (ADR-0028)."
  service_account     = google_service_account.kill_switch[0].id
  call_log_level      = "LOG_ERRORS_ONLY"
  deletion_protection = false # so kill_switch_enabled = false removes it
  source_contents     = file("${path.module}/kill-switch.workflow.yaml")
  user_env_vars = {
    PROJECT_ID = var.project_id
    REGION     = var.region
    SERVICE    = var.kill_switch_service
    RATIO      = tostring(var.kill_switch_ratio)
  }
  depends_on = [google_project_service.kill_switch]
}

resource "google_eventarc_trigger" "kill_switch" {
  count           = local.kill_switch
  name            = "cost-kill-switch"
  location        = var.region
  service_account = google_service_account.kill_switch[0].email

  matching_criteria {
    attribute = "type"
    value     = "google.cloud.pubsub.topic.v1.messagePublished"
  }
  transport {
    pubsub {
      topic = google_pubsub_topic.budget[0].id
    }
  }
  destination {
    workflow = google_workflows_workflow.kill_switch[0].id
  }

  depends_on = [google_project_iam_member.kill_switch]
}
