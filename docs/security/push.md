# Threat model: Web Push

Push subscriptions for the installed web app (M7: Mobile, ADR-0052). Risk register: [threat-model.md](threat-model.md) (R-AI-177, its row waits for AI-144: one file per risk). PRs that change this area update this file. Today only storage exists (AI-177: M7.7: PushSubscriptionStore port): nothing sends, no route accepts a subscription.

## Credentials stored

| What                                      | Grants                                                                                                     | Where                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Subscription endpoint + `p256dh` + `auth` | With the VAPID private key (AI-179: M7.10), send an encrypted push to that one device. Without it: nothing | Firestore `pushSubscriptions/{sha256(endpoint)}`, server-only: rules deny every client read and write; runtime SA only |
| Push settings, send counts                | None (quiet hours, categories, cap counters)                                                               | Firestore `pushSettings/{uid}`, `pushSendStates/{uid}`, server-only                                                    |

Never logged, never in a notice or the UI: the endpoint and keys stay in the store and the sender (AI-178: M7.9).

## Risk R-AI-177: push subscriptions

**Risk:** The endpoint is client-supplied, so a send to it is an outbound call to an arbitrary URL (SSRF) unless checked. A leaked endpoint and keys plus the VAPID key let someone push to Andy's phone. `save` replaces a subscription by endpoint whoever holds it, so a route that took the uid from the request could move or silence another user's device.

**Mitigation / next step:**

- Built (AI-177): endpoint must be `https`, ≤ 2,048 characters; keys base64url; at most 10 subscriptions per user (least recently used evicted), 50 per read; stored only.
- AI-185: M7.11: accept only endpoints on the push-service host allow-list (Apple, Google, Mozilla, Microsoft), checked again before every send; the uid comes from the session, never the body, with a test.
- AI-192: M7.13: delete a subscription on 404/410 or when off the allow-list; `deleteAllForUid` when a user leaves the sign-in allow-list.
- AI-179: M7.10: VAPID private key in Secret Manager.
- Severity: low (no route or sender yet). Status: open until AI-185 lands.
