# 2026-11-25 — AI-162: M6.14: Project budget module

- Built `infra/modules/project-budget`: one Cloud Billing budget per GCP project (50%, 90%, 100%, 150% actual, 100% forecast; $10/month default) and the opt-in kill switch, created in that project. `infra/billing` calls it per `managed_projects` entry; the control plane's budget is unchanged.
- The kill switch workflow YAML moved into the module folder; `infra/billing/kill-switch.tf` reads it from there (same content, so no plan change).
- `terraform test` with a mocked provider proves one budget per entry and no kill switch resources when off; `platform/actions/terraform-check` now runs tests in roots with `tests/`.
- Open: Andy's default for managed projects (ticket question 3); the code defaults to $10/month, kill switch off. Nothing applied.
