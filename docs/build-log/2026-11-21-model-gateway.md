# 2026-11-21 — Model gateway and OpenRouter adapter (AI-250: M10.10)

First paid-call code for M10: Paid models + spend caps (ADR-0129). Nothing calls it: M10.11: Direct-call steps on the gateway wires it behind the spend gate; it is `off` until the key exists (AI-266: M10.15).

- **Port:** `ModelGateway.complete(request)` in `packages/contracts/src/ports/model-gateway.ts`: model, messages, `maxOutputTokens`, optional timeout → `ok` (text, usage with input, output and cached tokens and reported cost, or null), `off` (no key) or `error`. Replaces the unused placeholder in `ports/index.ts`. Fake `InMemoryModelGateway`, contract suite `modelGatewayContract`.
- **Adapter:** `OpenRouterGateway` in `apps/api/src/openrouter.ts`, plain `fetch`, no new dependency. Sits beside `push-sender.ts` (the ticket said `adapters/`; no such folder exists).
- **Caps (ADR-0028):** `max_tokens` ≤ 32,000 always sent; ≤ 50 messages, ≤ 800,000 characters; one 60 s deadline, one retry on 5xx only; response ≤ 1 MiB; no redirects.
- **Key:** read by name (`openrouter-api-key`) on each call through a `readKey` seam; blank is `off`, unreadable is `error`. Never logged.
- **Tests:** mocked `fetch` only: no key, network or spend. Security: `docs/security/model-gateway.md`, risk R-AI-250.
