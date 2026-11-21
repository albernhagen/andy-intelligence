# 2026-11-21 — VAPID key secret (AI-179: M7.10: VAPID key secret)

Terraform for the Web Push key pair (ADR-0052, ADR-0115 Q2 option (a): Andy makes the keys on his Mac). Nothing is applied yet: Andy applies `infra/control-plane`.

- **Terraform** (`infra/control-plane`): secret container `vapid-private-key` (no version), `secretAccessor` for `control-plane-runtime` only, and the Cloud Run env `VAPID_PUBLIC_KEY` (plain) and `VAPID_PRIVATE_KEY` (secret ref) behind `push_enabled` (default false), the same two-step pattern as the Resend key (AI-77). `vapid_public_key` is validated as an 87-character base64url key.
- **Expected plans:** first apply 2 to add, 0 to change, 0 to destroy; after the version and `push_enabled = true`, 0 / 1 / 0 (the service's env).
- **CI plan:** `terraform-plan.yml` reads `TF_VAR_PUSH_ENABLED` and `TF_VAR_VAPID_PUBLIC_KEY` from repository variables (public values), defaulting to off.
- **Docs:** runbook `docs/runbooks/mobile.md`; credential rows in `docs/security/infrastructure.md` (full) and `entry-points-and-credentials.md` (short, pointing to it: the file is at its word budget).
