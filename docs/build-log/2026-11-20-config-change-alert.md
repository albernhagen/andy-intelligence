# 2026-11-20 — AI-136: Alert when a config change is not recorded in the change log

Follow-up to AI-118: M4.11: Config change log (PR #179), whose adversarial review asked for an alert on its failure log line.

- Terraform (`infra/control-plane`): log-based metric `config-change-not-recorded` (ERROR, `component: "projects"`, message `config change not recorded`, Cloud Run service `control-plane`) and alert policy "Config change not recorded in the change log" on the existing `alert_email` channel (ADR-0029 recipients). Sum over 5 minutes, fires above 0, missing data counts as quiet: one email per burst, closes by itself.
- Drift check: `packages/domain/src/config-changes.test.ts` reads `main.tf` and fails if the metric's message, component or severity differ from what `ProjectService` logs (`CONFIG_CHANGE_NOT_RECORDED`, unchanged).
- Docs: project baseline row (ARCHITECTURE §8.1; made room by merging the three identical `infra/control-plane` rows); `docs/runbooks/billing.md` section 7.
- **Andy applies:** root `infra/control-plane` only. Expected plan: 2 to add, 0 to change, 0 to destroy. No IAM, secret or entry-point change.
