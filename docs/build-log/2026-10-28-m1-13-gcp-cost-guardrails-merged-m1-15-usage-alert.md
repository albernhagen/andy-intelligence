# 2026-10-28 — M1.13: GCP cost guardrails merged; M1.15: Usage alerts built

- Merged: PR #7: GCP cost guardrails.
- Branch `m1.15/usage-alerts`: email channel + six Cloud Monitoring alert policies in `infra/control-plane` (Cloud Run requests and bytes sent; Firestore reads, writes, deletes; log ingestion). Monitoring API enabled. Thresholds in `usage_alert_thresholds` (billing runbook section 5).
- **Decided (Andy):** alert address is its own variable `alert_email` (gitignored tfvars + `TF_VAR_ALERT_EMAIL` Actions secret), not the allow-list; default thresholds as in the runbook.
- Verified: alerting is free until at least 2027-09-01 (then $0.35 per metric reference/month + $0.50 per million points). Firestore metric names from Firestore docs; Cloud Run and log metric names not confirmed from Google's reference pages (too large to read); the apply accepted all six.
- Applied by Andy (2026-10-28). Test: request threshold set to 0 → alert email arrived within minutes → restored. Firestore document metrics confirmed under the Cloud Firestore Database resource in Metrics Explorer (no data yet: nothing uses Firestore until M1.2: Ticket core). CI plan: "No changes".
- Lesson: `evaluation_missing_data` needs a non-zero `duration`; dropped (a threshold condition with no data stays inactive anyway).
