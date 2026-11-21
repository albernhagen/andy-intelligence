# 2026-11-20 — AI-177: M7.7: PushSubscriptionStore port

First M7: Mobile storage slice (ADR-0052: Mobile: installable web app with push). Storage only: nothing sends, no route, no UI.

- Contracts (`packages/contracts/src/{entities,ports,fakes,testing}/push.ts`, one `export *` line each): `PushCategory` (seven, from ADR-0052 minus budget alert and kill switch, which M7 leaves out), `PushSubscription`, `PushSettings`, `PushSendState` and the `PushSubscriptionStore` port, with an in-memory fake and a 17-case contract suite.
- Firestore adapter (`packages/store/src/push-subscription-store.ts`): `pushSubscriptions/{sha256(endpoint)}`, `pushSettings/{uid}`, `pushSendStates/{uid}`. New collections only: no migration, no `SCHEMA_VERSION` change, no rules change (clients are already denied everything), no composite index (one equality query on `uid`).
- Caps (ADR-0028): 10 subscriptions per user; an 11th device evicts the least recently used, inside the save's transaction. Each user query reads at most 50. Send counts update in a transaction, so two sends can't both pass a cap.
- Untrusted input: a subscription's endpoint must be an `https` URL of at most 2,048 characters and is only stored; the host allow-list and any call are M7.11 and M7.9. Keys must be base64url; uids must be `[A-Za-z0-9_-]` (they are document ids).
- Not yet in ARCHITECTURE §8.1: the file is at its word budget. The push caps' row goes in with M7.8: Push policy, which sets the hourly and daily caps.
