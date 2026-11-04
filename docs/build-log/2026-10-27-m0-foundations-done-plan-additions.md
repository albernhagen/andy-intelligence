# 2026-10-27 — M0: Foundations done; plan additions

- Merged: PR #1: Foundations, PR #3: gitignore Terraform plan files, PR #4: first Terraform apply, PR #5: service_url host.
- Infra applied by Andy (bootstrap 15 + 2 IAM fixes; control plane 27). CI plan shows "No changes". Deploy green. Google sign-in works at `https://control-plane-662512537397.us-central1.run.app`.
- Lessons: Identity Platform needs a quota project with local credentials; CI's `tf-plan` needed `serviceusage.serviceUsageConsumer` and `firebaserules.viewer`; Google sign-in provider is enabled by hand in Firebase (needs an OAuth client no API can create).
- Git history rewritten on all 4 repos to replace Andy's Gmail with the noreply address.
- **Decided (Andy):** adversarial PR review (ADR-0026), local quality gates (ADR-0027), GCP cost guardrails (ADR-0028). Custom domain after M5: Dev → prod releases.
