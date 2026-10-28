---
status: accepted
date: 2026-10-21
---

# 0015 — Public repository and secret hygiene

## Context and Problem Statement

Rulesets/branch protection aren't available for private repos on a free GitHub org, so the repo is public. Public means every file, commit (including author emails), and Actions log is world-readable, and agents will be committing to it.

## Decision Outcome

- **Never in the repo:** credentials, tokens, connection strings, personal emails, `*.tfvars`, `.env*`, Terraform state. `.gitignore` covers the file types; values live in Secret Manager, GitHub Actions secrets, or gitignored local files.
- **Personal data as config:** the allow-list is a `sensitive` Terraform variable supplied via gitignored `terraform.tfvars` or the `TF_VAR_ALLOWED_EMAILS` Actions secret, so it's redacted from plans.
- **Commit identity:** commits use `albernhagen@users.noreply.github.com`.
- **Detection, layered:**
  1. GitHub secret scanning + push protection (repo setting) — blocks known credential formats at push time.
  2. `secret-scan.yml` — TruffleHog OSS on every PR and push to `main`, failing on verified or unverifiable secrets; required status check on `main`.
  3. Agents (M1+) get the same rule in `AGENTS.md`: never echo or commit secret values; reference secrets by name.
- **Public logs:** CI prints only the Terraform plan summary line, never the full plan. Fork PRs never get cloud credentials (job conditions + Actions approval setting).
- Gitleaks' Action was rejected: it requires a license key for organization repos.

### Consequences

- Good: free branch protection and secret scanning; multiple independent checks.
- Bad: infrastructure shape (project ID, service account names) is public. These are identifiers, not credentials; acceptable.
