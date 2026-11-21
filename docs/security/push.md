# Threat model: Web Push

Push subscriptions for the installed web app (M7: Mobile, ADR-0052). Risk: [R-AI-177](risks/R-AI-177.md). PRs that change this area update this file. Built: storage (AI-177: M7.7: PushSubscriptionStore port) and the sender (AI-178: M7.9: web-push sender, `apps/api/src/push-sender.ts`). Nothing calls the sender until M7.13: Push notices, it is off until the VAPID keys exist (AI-179: M7.10), and no route accepts a subscription yet.

## Credentials stored

| What                                      | Grants                                                                                                     | Where                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Subscription endpoint + `p256dh` + `auth` | With the VAPID private key (AI-179: M7.10), send an encrypted push to that one device. Without it: nothing | Firestore `pushSubscriptions/{sha256(endpoint)}`, server-only: rules deny every client read and write; runtime SA only |
| Push settings, send counts                | None (quiet hours, categories, cap counters)                                                               | Firestore `pushSettings/{uid}`, `pushSendStates/{uid}`, server-only                                                    |

Never logged, never in a notice or the UI: the endpoint and keys stay in the store and the sender (AI-178: M7.9).

## Outbound requests (AI-178)

The sender POSTs to each subscription's `endpoint`, a URL the client chose. Unchecked, a stored endpoint could aim signed requests at an internal host (SSRF).

- **Host allow-list in the sender:** only `fcm.googleapis.com`, `push.apple.com`, `push.services.mozilla.com`, `notify.windows.com` and their subdomains, https on the default port, no credentials in the URL (`isPushServiceEndpoint`, `packages/contracts`). Anything else is refused before any work. The subscribe API (M7.11) checks the same list when storing.
- **No redirects** (`redirect: "error"`), so an allowed host can't bounce the request elsewhere.
- **Caps (ADR-0028):** 10 s timeout, payload ≤ 3072 bytes, TTL ≤ 1 day, ≤ 60 sends per instance per hour.
- **Logs:** the push service's host and status only; the endpoint path identifies a device and is never logged.
- **Payload:** encrypted per subscription (aes128gcm); content rules (no agent text) are M7.8: Push policy's.
- **VAPID key:** signs every request; a leaked key alone reaches no device (a push also needs a stored subscription). Read from env `VAPID_PRIVATE_KEY`; where it lives and how to rotate: AI-179.
