# 2026-11-21 — Jules API key secret (AI-233: M9.9: Jules API key secret)

Terraform for the Jules API key (epic AI-225: M9: Add Jules + model routing). Nothing is applied yet: Andy applies `infra/control-plane` after merge, in two steps (runbook `docs/runbooks/jules.md`).

- **Terraform** (`infra/control-plane`): secret container `jules-api-key` (no version), `secretAccessor` for `control-plane-runtime` only, and Cloud Run env `JULES_API_KEY` (secret ref) behind `jules_enabled` (default false): the Resend key's two-step pattern (AI-77: Email notifications).
- **Expected plans:** first apply 2 to add, 0 to change, 0 to destroy; after the version and `jules_enabled = true`, 0 / 1 / 0 (the service's env).
- **CI plan:** `terraform-plan.yml` reads the repository variable `TF_VAR_JULES_ENABLED`, defaulting to off.
- **Security:** credential row in `docs/security/agents-and-executors.md`; risk `R-AI-233` (medium, mitigated).
- **Kept apart from PR #249 (AI-179: VAPID key secret):** the env block, secret, variable and CI line sit in other places in each file, so the two merge in either order.
- No code reads the key until the Jules adapter (M9.10).
