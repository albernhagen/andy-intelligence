# 2026-11-22 — AI-314: Terraform plan always shows a Cloud Run revision change (fix forward)

**The first fix (PR #309) was wrong.** It added `template[0].revision` to `ignore_changes`. Terraform then sent the last CI deploy's revision name with a changed template, and Cloud Run refuses to reuse a revision name for a different configuration. Andy's apply of PR #303 (AI-268: M10.17: Weekly model scout job) failed: "Error 409: Revision named 'control-plane-00462-qen' with different configuration already exists".

- **Fix:** take `template[0].revision` out of `ignore_changes`, and set `revision = null` with a comment. Cloud Run then generates a name for each Terraform-made revision.
- **Cost of the fix:** after every CI deploy, a plan shows `template.revision = "<name>" -> null` (1 to change). Applying it makes a new revision with the same image (ignored, so state keeps the deployed one) and settings. Runbook `deploy-and-rollback.md` §5 says so.
- **Traffic:** CI deploys move traffic with `--to-latest` (ADR-0076), so traffic follows the latest revision, and Terraform ignores `traffic`. A Terraform-made revision, including this one with `MODEL_SCOUT_INVOKER_EMAIL`, serves at once with no smoke test. The exception: after a rollback or a failed deploy, traffic is pinned to one revision, so the new revision gets none until the next good deploy or `update-traffic --to-latest`.
- `terraform fmt` and `terraform validate` pass. Nothing was planned or applied against the real project.
- **Andy applies** `infra/control-plane`. Expect 0 to add, 1 to change (`google_cloud_run_v2_service.control_plane`: `revision` → null, env `MODEL_SCOUT_INVOKER_EMAIL`), 0 to destroy. Anything else from PR #303 that the failed apply didn't create also shows as "to add": read it before applying.
