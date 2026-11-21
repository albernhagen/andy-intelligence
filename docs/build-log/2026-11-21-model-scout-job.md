# 2026-11-21 — Weekly model scout job (AI-268: M10.17)

Runs the model scout (AI-237: M10.5) once a week, for M10: Paid models + spend caps. Off until Andy applies its Terraform.

- **Job:** `ModelScoutJob` in `apps/api/src/model-scout.ts`. Fetches OpenRouter's public models list (no key, 15 s, 5 MiB, no redirects), runs `scoutProposal` on the global tiers and 30 days of outcomes (succeeded / succeeded + failed per model, ≤ 500 runs × 50 projects), and writes at most one pending ConfigChange (entity `tiers`, actor `scout`). It never changes a tier.
- **Once a week:** dedupe key `model-scout:<ISO week>`; a pending or decided change for the week makes later calls a no-op before any fetch. A list that fails or doesn't parse skips the week, logged.
- **Route:** `POST /jobs/model-scout`, Google OIDC token for `scout-scheduler` only (the watchdog's verifier), ≤ 6 calls an hour; env `MODEL_SCOUT_INVOKER_EMAIL`, route absent without it.
- **Terraform (Andy applies, `infra/control-plane`):** Cloud Scheduler API, SA `scout-scheduler` (no roles), job `model-scout-weekly` (Mondays 06:00 UTC, one retry), one env var on the service.
- **Not built:** the research sentences and the scout agent task (steps 2 and 3 of `model-scout.md`): they wait for M10.17's question (subscription or paid). `price_change` waits for a stored model price (none yet), so it never fires.
- Security: `entry-points-and-credentials.md`, `infrastructure.md`, risk R-AI-268.
