---
status: accepted (direction; sliced at M7 start)
date: 2026-11-04
---

# 0052 — Mobile: the control-plane UI as an installable web app with push, in M7

Decided by Andy, 2026-11-04.

## Context and Problem Statement

Andy wants to drive work away from his desk: be told when something needs him, then answer questions, approve plans and gated PRs, promote releases and see what agents did, from his phone. The Needs-you inbox is UI-only today (§1 non-goals) and the SPA is laid out for a desktop.

| Option                                  | Verdict                                                                                                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Native app (Swift / Kotlin)          | Rejected: a second and third UI codebase, app-store accounts and review, nothing reused.                                                                                                                                                     |
| B. React Native / Expo                  | Rejected for now: a second UI codebase and a push service to run, for one user.                                                                                                                                                              |
| **C. Installable web app (PWA) + push** | **Chosen.** The existing React SPA gets a phone layout, a manifest and a service worker, and Web Push (VAPID) behind the `Notifier` port. iOS has supported Web Push for Home Screen web apps since 16.4. One codebase, no store, same auth. |

## Decision Outcome

| Topic         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When          | New milestone **M7: Mobile**, after M6: Dev → prod releases (promote and rollback are among the actions) and before M3: Add Jules + model routing. Sliced at milestone start.                                                                                                                                                                                                                                                          |
| Phone screens | Needs-you inbox, ticket detail with run summary, releases, quota and spend banner. Actions: answer a question, approve or reject a plan, approve a gated PR (merged by the control plane with the App token), promote or roll back a release, pause and resume dispatch. Everything else stays desktop-first.                                                                                                                          |
| Notifications | `Notifier` adapter `web-push`: VAPID key pair in Secret Manager; subscriptions in Firestore behind a `PushSubscriptionStore` port (fake + suite), keyed by Andy's uid and deleted when his email leaves the allow-list. Notices: question asked, plan or PR awaiting Andy, run failed after its retry, dev verification result and release ready, quota warn or pause, budget alert, kill switch tripped. Each deep-links to its item. |
| Content       | Plain text: ticket key, a title capped at 100 characters, the category. **Agent-written text never goes into a notification** (it would reach the lock screen and is untrusted input); the inbox shows the rest.                                                                                                                                                                                                                       |
| Caps          | ADR-0028: at most N pushes per hour and per day (set in the slice), a digest when exceeded; quiet hours; per-category toggles in Settings.                                                                                                                                                                                                                                                                                             |
| Email         | The same `Notifier` routing: an email adapter can land earlier as the pending S slice (build log); push reuses its notice types and caps.                                                                                                                                                                                                                                                                                              |
| Security      | Same Firebase Google sign-in in the installed app. New entry point `POST /api/push/subscribe` (signed-in, allow-listed) and new credential (VAPID private key) go into the threat model in the slice. Push payloads are encrypted end to end by the Web Push protocol; the browser vendor's push service sees only ciphertext.                                                                                                         |
| Fallback      | The first slice verifies push on Andy's iPhone before any screen work. If Home Screen push is unreliable, wrap the same SPA with Capacitor (native shell, same code) in a new ADR; no React Native.                                                                                                                                                                                                                                    |
| Done when     | Installed on Andy's iPhone from Safari; a refinement question arrives as a push within a minute and tapping it opens that question; Andy answers a question, approves a plan, approves a gated PR and promotes a release from the phone; quiet hours silence pushes; the endpoint and key are in the threat model.                                                                                                                     |

Non-goals: offline editing, app-store presence, multi-user, a separate mobile design system (the `design.md` from M5: Epics + story board covers both widths).

### Consequences

- Good: one UI codebase and one auth; the loop no longer waits for an open desktop tab; notifications are a port, so email, Slack or a native shell are adapters later.
- Bad: iOS web-app push has limits (no badge count on older versions, subscriptions dropped if the app is unused for weeks); a Capacitor wrapper adds a native build if the fallback is needed; one more entry point and secret.
