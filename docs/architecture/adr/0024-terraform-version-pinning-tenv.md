---
status: accepted
date: 2026-10-22
---

# 0024 — Pin Terraform with `.terraform-version`; manage it with tenv

## Context and Problem Statement

Terraform was only constrained to `>= 1.9`, so Andy's machine and CI could run different versions, and provider versions weren't locked. Upgrades need to be deliberate and repeatable.

## Considered Options

1. Homebrew `terraform`, no pin.
2. tfenv (shell-based, Terraform only).
3. **tenv** — Go binary, reads `.terraform-version` (tfenv-compatible), auto-installs the pinned version, verifies signatures, also handles OpenTofu.

## Decision Outcome

Option 3.

- `.terraform-version` at the repo root pins the CLI (`1.16.7`; `1.17.0` was one day old).
- Local: tenv reads it. CI: workflows pass the same file's version to `hashicorp/setup-terraform`.
- `required_version = ">= 1.16, < 2.0"` in each root as a guardrail.
- `.terraform.lock.hcl` is committed per root, locked for `darwin_arm64` and `linux_amd64`.
- Upgrades are their own PR with a reviewed plan (runbook: Upgrading Terraform).

### Consequences

- Good: same Terraform everywhere; upgrades are one-line, reviewable PRs.
- Bad: one more tool to install; lock files must be regenerated for both platforms on provider upgrades.
