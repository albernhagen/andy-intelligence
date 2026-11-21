# Threat model: Web Push

Web Push to Andy's devices (M7: Mobile, ADR-0052, ADR-0115). Risk register: [threat-model.md](threat-model.md) (R-AI-178). Built so far: the sender (AI-178: M7.9: web-push sender, `apps/api/src/push-sender.ts`); nothing calls it until M7.13: Push notices, and it is off until the VAPID keys exist (AI-179: M7.10: VAPID key secret).

## Credential

| Identity / secret                            | Grants                                                                                                  | Where                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| VAPID key pair (`VAPID_PRIVATE_KEY`, AI-178) | Signs push requests: whoever holds it, plus a subscription's endpoint and keys, can push to that device | Env var from Secret Manager (AI-179); never logged, never in Terraform state (ADR-0115 Q2) |

A leaked key alone reaches no device: a push also needs a subscription's endpoint and keys, stored server-side (M7.7). Rotation: new key pair, every device subscribes again.

## Outbound requests

The sender POSTs to each subscription's `endpoint`, a URL the browser (so the client) chooses. Without a check, a stored endpoint could aim signed requests at an internal host (SSRF).

- **Host allow-list in the sender:** only `fcm.googleapis.com`, `push.apple.com`, `push.services.mozilla.com`, `notify.windows.com` and their subdomains, https on the default port, no credentials in the URL (`isPushServiceEndpoint`, `packages/contracts`). Anything else is refused before any work. The subscribe API (M7.11) checks the same list when storing.
- **No redirects** (`redirect: "error"`), so an allowed host can't bounce the request elsewhere.
- **Caps (ADR-0028):** 10 s timeout, payload ≤ 3072 bytes, TTL ≤ 1 day, ≤ 60 sends per instance per hour.
- **Logs:** the push service's host and status only; the endpoint path identifies a device and is never logged.
- **Payload:** encrypted per subscription (aes128gcm); content rules (no agent text) are M7.8: Push policy's.
