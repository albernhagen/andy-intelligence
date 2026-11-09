# Agent rules — `infra/` (Terraform)

Loaded when you work here; the root `AGENTS.md` still applies.

- Terraform version from `.terraform-version` (install with `tenv`); commit `.terraform.lock.hcl` (ADR-0024). Run `terraform fmt` and `terraform validate` per root you touch.
- Never `apply`. Andy plans and applies locally, one root at a time. In the PR and build log, say which roots to apply and the expected plan counts (adds/changes/destroys).
- Never commit `*.tfvars`, state, plan files or `.terraform/` (ADR-0015); add a `*.tfvars.example` instead.
- New IAM grant, service account, entry point or credential: update `docs/security/threat-model.md` and its area file (`docs/security/infrastructure.md`) in the same PR. Grant the narrowest role on the narrowest resource.
- Anything that scales or spends gets an explicit cap (ADR-0028), and its guardrail row in ARCHITECTURE §8.1.
- `infra/billing` plans locally only; CI has no billing role (ADR-0029).
