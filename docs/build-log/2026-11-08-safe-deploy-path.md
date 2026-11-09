# 2026-11-08 — Safe deploy path (AI-62: Safe deploy path)

Each merge now deploys a no-traffic `candidate` revision, smoke tests it, then moves traffic (ADR-0076: Control-plane deploy: no-traffic revision, smoke test, then traffic). Runbook: `docs/runbooks/deploy-and-rollback.md`.

- Checked against gcloud's source and `deploy-cloudrun` v3.0.1: `--no-traffic` pins traffic that was on latest to the current revision; `--tag` moves an existing tag.
- The candidate can't answer `/api/me` 401 (host rule, ADR-0044), so that check runs on the public URL after traffic moves.
- Promotion uses `--to-latest` so Terraform template changes keep going live.
- Not proven live yet: no credentials here. The proof is Andy's first deploy after merge (runbook §2).
- `autoMerge` for project `AI` stays `none` until that proof (ADR-0050).
