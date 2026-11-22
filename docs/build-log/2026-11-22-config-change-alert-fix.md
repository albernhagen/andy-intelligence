# 2026-11-22 — AI-136: Alert when a config change is not recorded (apply fix)

Andy applied PR #217: AI-136: Alert when a config change is not recorded in the change log. The metric was created; the API refused the alert policy: `evaluation_missing_data` needs a non-zero `duration`, and the policy uses `duration = "0s"` to fire on the first failure.

- Fix: drop `evaluation_missing_data` from `google_monitoring_alert_policy.config_change_not_recorded`. A threshold condition with no data stays inactive anyway, so the behaviour is unchanged (same lesson as 2026-10-28, M1.15: Usage alert).
- **Andy applies:** root `infra/control-plane` only. Expected plan: 1 to add (the alert policy; the metric already exists), 0 to change, 0 to destroy.
