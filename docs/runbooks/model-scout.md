# Weekly model scout — runbook (Andy)

Turns on the weekly model scout (AI-268: M10.17: Weekly model scout job). Until the apply, `POST /jobs/model-scout` doesn't exist and nothing runs.

| Term                 | Meaning                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `scout-scheduler`    | Service account with no roles; Cloud Scheduler signs each call's OIDC token as it                  |
| `model-scout-weekly` | Cloud Scheduler job: Mondays 06:00 UTC, one retry, `POST https://<custom domain>/jobs/model-scout` |
| Pending change       | What a run can create: one tier change per ISO week, shown in the Needs-you inbox                  |

No secret, key or spend: the models list is public.

## 1. Apply (once)

In `infra/control-plane`: `terraform plan`, expect **3 to add, 1 to change, 0 to destroy** (the Cloud Scheduler API, SA `scout-scheduler`, job `model-scout-weekly`; env `MODEL_SCOUT_INVOKER_EMAIL` on the `control-plane` service). Then `terraform apply`. The next deploy (or the apply's new revision) registers the route.

## 2. Check it

1. `gcloud scheduler jobs run model-scout-weekly --location <region>`.
2. Logs (`component: model-scout`): `model scout: no change`, `... proposed a tier change`, or `... skipped this week` with the reason. A second run in the same week logs `already ran this week`; while a proposal waits for you, later weeks log `waits for Andy to decide its open proposal`.
3. A proposal shows in the Needs-you inbox. Accepting it records your decision; edit the tier in Settings → Models to apply it.

## Turn it off

`gcloud scheduler jobs pause model-scout-weekly --location <region>` (resume the same way), or remove the job from Terraform.
