# Threat model: Web Push

Push subscriptions for the installed web app (M7: Mobile, ADR-0052). Risk: [R-AI-177](risks/R-AI-177.md). PRs that change this area update this file. Today only storage exists (AI-177: M7.7: PushSubscriptionStore port): nothing sends, no route accepts a subscription.

## Credentials stored

| What                                      | Grants                                                                                                     | Where                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Subscription endpoint + `p256dh` + `auth` | With the VAPID private key (AI-179: M7.10), send an encrypted push to that one device. Without it: nothing | Firestore `pushSubscriptions/{sha256(endpoint)}`, server-only: rules deny every client read and write; runtime SA only |
| Push settings, send counts                | None (quiet hours, categories, cap counters)                                                               | Firestore `pushSettings/{uid}`, `pushSendStates/{uid}`, server-only                                                    |

Never logged, never in a notice or the UI: the endpoint and keys stay in the store and the sender (AI-178: M7.9).
