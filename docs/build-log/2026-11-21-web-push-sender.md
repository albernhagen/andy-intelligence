# 2026-11-21 — Web Push sender (AI-178: M7.9: web-push sender)

First push code for M7: Mobile (ADR-0052, ADR-0115). Nothing calls it yet: M7.13: Push notices composes it behind `Notifier`.

- **Port:** `PushSender` in `packages/contracts/src/ports/push-sender.ts`, with a minimal `PushTarget` (endpoint and keys) until M7.7: `PushSubscriptionStore` port lands; fake `InMemoryPushSender` and contract suite `pushSenderContract` (sent, gone, error, a bad endpoint never reaches the service).
- **Adapter:** `WebPushSender` in `apps/api/src/push-sender.ts`. The `web-push` library (3.6.7, pinned; 4.0.0 was two weeks old and a new major) only encrypts (aes128gcm) and signs VAPID; the request goes out with `fetch`. Results: `sent` (2xx), `gone` (404, 410: the caller deletes the subscription), `error`, `off` (keys unset), `capped`.
- **Caps (ADR-0028):** 10 s timeout, redirects refused, TTL default 1 hour and at most a day, payload at most 3072 bytes, at most 60 sends per instance per clock hour (a backstop over the policy's 6 an hour). https endpoints only (plain HTTP is a test seam).
- **Config:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (`pushConfigFromEnv`, off and logged once when unset); subject `https://ai.andybernhagen.com`, no email. The secret and Terraform are M7.10: VAPID key secret.
- **Logs:** structured lines name the push service's host and status, never the endpoint's path (it identifies the device).
- **Tests:** a local HTTP fake push service: sent, gone, error, timeout, TTL cap, payload cap, hourly cap, https rule, log redaction; no network.
