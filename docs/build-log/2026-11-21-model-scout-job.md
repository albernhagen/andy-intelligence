# 2026-11-21 — Weekly model scout job (AI-268: M10.17)

Runs the model scout (AI-237: M10.5) once a week, for M10: Paid models + spend caps. Off until Andy applies its Terraform.

- **Job:** `ModelScoutJob` in `apps/api/src/model-scout.ts`. Fetches OpenRouter's public models list (no key, 15 s, 5 MiB, no redirects), runs `scoutProposal` on the global tiers and 30 days of outcomes (succeeded / succeeded + failed per model, ≤ 500 runs × 50 projects), and writes at most one pending ConfigChange (entity `tiers`, actor `scout`). It never changes a tier.
- **Once a week:** dedupe key `model-scout:<ISO week>`; a pending or decided change for the week makes later calls a no-op before any fetch. A list that fails or doesn't parse skips the week, logged. While an earlier scout proposal is still pending, each week is skipped (`awaiting_decision`): one open proposal at a time, so nothing piles up or goes stale.
- **Route:** `POST /jobs/model-scout`, Google OIDC token for `scout-scheduler` only (the watchdog's verifier), ≤ 6 calls an hour; env `MODEL_SCOUT_INVOKER_EMAIL`, route absent without it.
- **Terraform (Andy applies, `infra/control-plane`):** Cloud Scheduler API, SA `scout-scheduler` (no roles), job `model-scout-weekly` (Mondays 06:00 UTC, one retry), one env var on the service.
- **Research (step 3):** only when the `scout` step routes to `direct`, and only by the call that created the week's change (claim first, then `ConfigChangeStore.appendReason`, new): one `DirectExecutor` call (AI-258) adds at most two sentences per proposed tier to the reason, labelled model-written; a refused or failed call (no key, no price, a cap) is logged and the proposal goes without them. `services.ts` now builds one spend gate for `RunService` and the `DirectExecutor`.
- **Follow-up:** the scout agent task (claude-sub, steps 2 and 3 with web pages) waits for Andy's answer to M10.17's question (subscription or paid); the coordinator files it. `price_change` waits for a stored model price (none yet), so it never fires.
- Security: `entry-points-and-credentials.md`, `infrastructure.md`, risk R-AI-268.
