---
status: accepted
date: 2026-10-27
---

# 0028 — GCP cost guardrails: budgets, alerts, and caps on everything that scales

## Context and Problem Statement

The control plane runs on a public Cloud Run URL and will add Cloud Tasks, Scheduler, backups, and per-project dev/prod GCP projects. A bug, a loop, or abuse of the public URL could run up a surprise bill. Andy wants hard protection, not just visibility.

## Decision Outcome

Three layers, all in Terraform:

| Layer                    | What                                                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Caps on usage**        | Cloud Run `max_instance_count` (2 now), request timeout and concurrency set; Cloud Tasks queue max rate and concurrency; Artifact Registry cleanup policy (done); log retention at default 30 days with noisy logs excluded; Firestore stays on the free tier (alert on approach). |
| **Budget alerts**        | A Cloud Billing budget per GCP project, email to Andy at 50%, 90%, 100% of actual spend and 100% of forecast. Starting budget: **$25/month** for the control plane (Andy can change).                                                                                              |
| **Kill switch (opt-in)** | Budget → Pub/Sub → small function that scales Cloud Run to zero instances (and pauses Cloud Tasks queues) when spend passes **150%** of budget, then flags Needs-you. It does not disable billing, which can delete resources. Off until Andy turns it on.                         |

- The billing account ID is an identifier, not a secret, but it stays out of the public repo: a gitignored `terraform.tfvars` locally and a GitHub Actions secret for CI plans.
- Budgets live at the billing-account level, so they go in their own Terraform root (`infra/billing`), applied by Andy. CI's read-only plan identity gets the narrowest billing read role needed, or that root is plan-only locally (builder proposes).
- Managed projects: each `<app>-dev` / `<app>-prod` project gets its own budget and caps from the template (M5: Dev → prod releases).
- Model spend is separate: OpenRouter caps and subscription reserves (ARCHITECTURE §5) are enforced by the control plane, not GCP.

Lands in slice M1.13: GCP cost guardrails.

### Consequences

- Good: surprise costs are capped and visible within hours; the public URL can't scale without bound.
- Bad: billing data lags by hours, so budgets are a backstop, not real-time; the kill switch takes the app offline until Andy re-enables it.
