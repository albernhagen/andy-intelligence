---
status: accepted
date: 2026-10-21
---

# 0007 — One Cloud Run service in us-central1 on the default run.app URL

## Decision Outcome

- GCP project `andy-intelligence-512400`, region `us-central1` (tier-1 pricing; every needed service available, incl. Cloud Deploy).
- One Cloud Run v2 service, `control-plane`, serving API, SPA, and later `/mcp` and webhooks. Scale 0–2, 1 vCPU / 512 MiB, CPU only during requests.
- Default URL `https://control-plane-<project-number>.us-central1.run.app` (deterministic, so Terraform can reference it before the service exists). Custom domain deferred.
- Images in Artifact Registry `us-central1-docker.pkg.dev/andy-intelligence-512400/control-plane`, keep 10 most recent, delete older than 30 days.

### Consequences

- Good: near-zero idle cost; one deploy unit.
- Bad: cold starts on first request; scheduled jobs and long webhooks share the service (revisit if it hurts).
