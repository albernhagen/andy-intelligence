---
status: accepted
date: 2026-11-03
amends: 0007
---

# 0044 — Custom domain `ai.andybernhagen.com` now, via a Cloud Run domain mapping

Decided by Andy, 2026-11-03 (M1.20: Custom domain). ADR-0007 kept the default `run.app` URL and ARCHITECTURE §12 deferred a custom domain until after M6: Dev → prod releases. Andy wants it now: `PUBLIC_URL` is baked into the GitHub App, the Claude MCP connector and CI's OIDC audience, so every slice that uses it makes a later switch costlier.

## Decision Outcome

| Question          | Decision                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host              | `https://ai.andybernhagen.com`. Andy owns `andybernhagen.com`; DNS is on Cloudflare.                                                                                                                                                                                                                                                                                                                        |
| How it's served   | **Cloud Run domain mapping** (`google_cloud_run_domain_mapping`, `us-central1`), $0. Google-managed certificate (~15 min, up to 24 h). The account that applies it must be a verified Search Console owner of `andybernhagen.com`.                                                                                                                                                                          |
| Rejected          | Global HTTPS load balancer: ~$18/month breaks the $25 budget (ADR-0028). Firebase Hosting rewrite: 60-second request cap and an extra hop; blocks streaming responses later.                                                                                                                                                                                                                                |
| DNS               | New Terraform root `infra/dns` (Cloudflare provider): the `ai` CNAME to `ghs.googlehosted.com`, **DNS-only** (Cloudflare's proxy stops Google issuing the certificate), and the Search Console TXT. Local plans and applies only, like `infra/billing` (ADR-0029). Token: Cloudflare "Edit zone DNS" on this one zone, from the keychain via `CLOUDFLARE_API_TOKEN`; never in the repo, tfvars, CI or chat. |
| `PUBLIC_URL`      | `https://ai.andybernhagen.com`: OAuth issuer and MCP resource (ADR-0039), GitHub App manifest URLs (ADR-0043), Actions OIDC audience (`system-security-review.yml`).                                                                                                                                                                                                                                        |
| Old `run.app` URL | Keeps serving (it can't be removed without another Preview flag), but is **removed from Firebase authorized domains**: no sign-in there, and its MCP/OIDC requests fail the issuer/audience checks.                                                                                                                                                                                                         |
| Cutover           | Apply `infra/dns`, targeted apply of the mapping, wait for the certificate, then the rest (`PUBLIC_URL`, authorized domains). Andy edits the GitHub App's URLs and re-adds the Claude connector. Runbook `docs/runbooks/custom-domain.md`.                                                                                                                                                                  |

### Consequences

- Good: a stable URL that outlives the GCP project number; $0; switching later would have cost more.
- Bad: domain mappings are Preview; Google calls them "not recommended for production" because of latency. TLS 1.0/1.1 can't be turned off. Whoever controls the Cloudflare zone controls sign-in and CI tokens (threat model R20): Cloudflare 2FA and registrar lock matter now. Revisit with a load balancer if latency hurts or the budget grows.
