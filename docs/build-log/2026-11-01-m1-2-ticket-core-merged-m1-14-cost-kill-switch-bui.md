# 2026-11-01 — M1.2: Ticket core merged; M1.14: Cost kill switch built

- Merged: PR #17: Ticket core. Andy to run: `infra/control-plane` apply (6 adds), `pnpm test:firestore`, Done-when check (`docs/runbooks/ticket-core.md`).
- **Decided (Andy, ADR-0036: Kill switch runs on Cloud Workflows):** Cloud Workflows instead of a function; Needs-you item deferred until M1.3: UI: tickets + inbox; switch stays on in Andy's tfvars after the demo (code default off).
- Verified (Google docs): manual scaling at 0 instances disables a Cloud Run service without a new revision; budget messages arrive several times a day, at least once, with `costAmount`/`budgetAmount`.
- Branch `m1.14/cost-kill-switch`: `infra/billing/kill-switch.tf` (topic, Eventarc trigger, workflow, `cost-kill-switch` SA with a custom role) behind `kill_switch_enabled`; 150% budget threshold; billing runbook §4 (turn on, fake-message test, re-enable, turn off).
- Verified locally: `terraform fmt`, Trivy clean, workflow YAML parses. Not run here: `terraform validate` (CI) and the apply + fake-message demo (Andy).
