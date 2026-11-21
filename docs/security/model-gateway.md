# Threat model: Model gateway (OpenRouter)

Direct model calls through OpenRouter (M10: Paid models + spend caps, ADR-0129). Risk: [R-AI-250](risks/R-AI-250.md). PRs that change this area update this file. Built: the `ModelGateway` port and the OpenRouter adapter (AI-250: M10.10, `apps/api/src/openrouter.ts`). Nothing calls it: M10.11: Direct-call steps on the gateway wires it behind the spend gate, and it is `off` until the key exists (AI-266: M10.15).

## Credentials

| What               | Grants                                        | Where                                                                                    |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| OpenRouter API key | Spend up to the key's credit limit, any model | Secret Manager `openrouter-api-key` (planned, AI-266: M10.15), read by name on each call |

Never in the repo, the request, a log, a prompt or the UI. Blank or missing key: the call is `off` and nothing is sent. Unreadable secret: `error` (fail closed).

## Outbound requests

- **One fixed URL:** `https://openrouter.ai/api/v1/chat/completions`; the model id and messages are the only caller input. No redirects (`redirect: "error"`).
- **Caps (ADR-0028):** `max_tokens` always sent, at most 32,000; at most 50 messages and 800,000 characters in; one 60 s deadline per call, retry included; one retry, on 5xx only; response body at most 1 MiB, read no further.
- **Response is untrusted:** schema-checked; only the reply text and usage numbers leave the adapter. The reply is model output: data, never instructions, for whatever step uses it (M10.11).
- **Logs:** model id, status, reason and usage numbers only. Never the key, the messages, the reply or the provider's error body (it may echo the request); a test checks.
- **Spend:** this adapter does not check caps; every caller goes through the spend gate (ADR-0129, M10.11). The key's own credit limit is the second layer (AI-266: M10.15).
