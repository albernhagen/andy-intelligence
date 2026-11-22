# 2026-11-21 — AI-314: Terraform plan always shows a Cloud Run revision change

Every plan of `infra/control-plane` showed `template.revision = "control-plane-00312-zaq" -> null` on `google_cloud_run_v2_service.control_plane`: CI deploys (ADR-0076: safe deploy) create a named revision outside Terraform, and an apply would have tried to clear it.

- **Fix:** `template[0].revision` joins the resource's `lifecycle.ignore_changes`, beside the image and revision labels the same deploys own; the comment says so. `terraform fmt` and `terraform validate` pass (validate rejects an unknown attribute path).
- **Provider docs** (`google_cloud_run_v2_service`, google 8.12.0): `template.revision` is optional, "The unique name for the revision", generated from the service name when omitted. The page says nothing about deploys outside Terraform and gives no `ignore_changes` advice for it; ignoring it follows Terraform's general `lifecycle` practice for attributes another system manages, as this file already does for the image and labels.
- **Andy applies** `infra/control-plane`: the revision line is gone from the plan; expect 0 to add, 0 to change, 0 to destroy afterwards. If AI-136's alert (PR #217, merged today) isn't applied yet, the same plan also shows its 2 to add.
