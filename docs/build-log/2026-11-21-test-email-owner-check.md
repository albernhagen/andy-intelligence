# 2026-11-21 — AI-289 follow-up: test email is owner only, enforced

A reviewer on PR #323 noticed that `test_email` and `POST /api/notify/email/test` were labelled "owner only" in `project-access.ts`, but only the allow-list protected them: nothing called `requireCan`.

- **New owner action `send_test_email`** (`packages/domain/src/permissions.ts`). `EmailNotifications.sendTest(by)` requires it, and the shared `sendTestEmail(email, by)` checks it first, so a non-owner gets `forbidden` even when email isn't configured.
- **Both sides pass their caller:** the route `actorOf(identity)`, the tool `deps.actor`. Every allow-listed user is the owner today, so nothing changes for Andy; agents and the system are refused.
- **Domain tests:** a non-owner (`agent:…`, `system`) is refused with nothing sent and no slot used; the owner's send goes out and counts.
- The `project-access.ts` notes now say "enforced", like other owner-only entries; the security note in `entry-points-and-credentials.md` names the action.
