# Cloud Run services with ADR-0028 caps: scale to zero, max instances, concurrency, timeout.
# Terraform owns the shape; deploys own the image, revision labels and traffic (ADR-0076), as in
# infra/control-plane. Scaling and identity are Terraform's: a deploy that changes them shows as
# drift on the next plan.

resource "google_cloud_run_v2_service" "main" {
  project              = var.project_id
  name                 = var.service_name
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = var.allow_unauthenticated
  deletion_protection  = true

  template {
    # Unset, never ignored (AI-314): deploys name each revision, so after a deploy every plan
    # shows `revision = "<last deploy's name>" -> null`. That line is expected.
    revision                         = null
    service_account                  = google_service_account.runtime.email
    timeout                          = "${var.request_timeout_seconds}s"
    max_instance_request_concurrency = var.concurrency

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      # Placeholder until deploy.yml pushes the first image; deploys own the image from then on.
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = true
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].labels,
      traffic,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.apis]
}

# PR previews (ADR-0114): each same-repo PR gets a no-traffic revision tagged pr-<n> (at most 10,
# kept by the deploy action). One instance by default across all of them.
resource "google_cloud_run_v2_service" "preview" {
  count                = local.preview
  project              = var.project_id
  name                 = local.preview_name
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = var.preview_allow_unauthenticated
  deletion_protection  = false

  template {
    revision                         = null
    service_account                  = google_service_account.preview_runtime[0].email
    timeout                          = "${var.request_timeout_seconds}s"
    max_instance_request_concurrency = var.concurrency

    scaling {
      min_instance_count = 0
      max_instance_count = var.preview_max_instances
    }

    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = true
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].labels,
      traffic,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.apis]
}
