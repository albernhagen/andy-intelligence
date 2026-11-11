# 2026-11-10 — AI-77: Email notifications for the inbox

- Built ADR-0060's email for the Needs-you inbox: a `Notifier` email adapter on Resend (`apps/api/src/notifier-email.ts`, official `resend` package 6.37.0; 6.38.0 was inside the 7-day cooldown).
- One hook sees every Needs-you path: `notifyOnNeedsYou` wraps the WorkTracker's `updateTicket` and fires when `needsAttention` turns on, unless Andy did it. Rules in `packages/domain/src/notify-email.ts`.
- Batching and caps (ADR-0028): items wait in a 10-minute window, then go out as one plain-text email; 20 a UTC day, then one "more waiting", then nothing. Agent text: one line, links removed, never in the subject.
- State survives scale-to-zero: new port `NotifyLedger` (Firestore `config/emailNotify`, transactional). The window's flush is a Cloud Tasks task on the existing `run-watchdog` queue (new port `NotifyFlushQueue`) to `POST /notify/email/flush`, verified like the watchdog; no new queue or IAM beyond the secret.
- Setting `emailNotifications` (default on) in REST, MCP `set_email_notifications`, `get_project_settings` and Project settings, which also shows configured or off, today's count and "Send test email" (`/api/notify/email`, `/api/notify/email/test`).
- Terraform (`infra/control-plane`): secret container `resend-api-key` + runtime accessor; `email_from`/`email_to` variables (default empty: off). Env vars are set only when both are filled, so nothing references the secret before it has a version.
- Andy: runbook `email-notifications.md` (Resend account, domain, apply: 2 to add; key version; addresses: 1 to change; test). No `SCHEMA_VERSION` bump (new fields have defaults; new `config` document).
