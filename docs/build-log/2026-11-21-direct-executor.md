# 2026-11-21 — Direct-call steps on the gateway (AI-258: M10.11)

First caller of the model gateway (AI-250: M10.10), for M10: Paid models + spend caps (ADR-0129). Nothing runs on it yet: no tier routes `direct` by default, no step calls it until Andy answers AI-258's question (which steps move first), and the gateway is `off` until the key exists (AI-266: M10.15).

- **Executor:** `DirectExecutor.run` in `apps/api/src/direct-executor.ts`. Resolves the step's route; anything but `direct` returns `not_direct` and never touches the gateway. Refine, plan, build and sync are refused (agentic).
- **Spend:** creates a run, reserves through the spend gate (AI-248: M10.7: the per-task cap), sizes `max_tokens` so two attempts' worst case fits it (`MODEL_MAX_ATTEMPTS`; input bounded by UTF-8 bytes), then settles: at usage after an answer, in full after a gateway error, released when nothing was sent (no key, cap too small, no price).
- **Answer:** JSON (one ```json fence allowed) checked against the step's zod schema; a failure fails the run with the validation error and still settles. The value goes back to the caller; prompt and answer are neither logged nor stored.
- **Not wired:** no service builds a `DirectExecutor` yet (the ticket listed one `app.ts` line); the first single-call step wires it with its own call.
- **Tests:** fake gateway, ledger, run and routing stores: refusal, no price, sizing, schema failure, gateway error, no key, agentic refusal, log redaction.
