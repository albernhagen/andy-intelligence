---
status: accepted
date: 2026-10-27
---

# 0029 — Billing root plans locally; budget alerts use default recipients; kill switch is its own slice

Amends ADR-0028: GCP cost guardrails and ADR-0011: Terraform layout and CI identity. Decided by Andy in M1.13: GCP cost guardrails.

## Context and Problem Statement

ADR-0028 left three things open or bundled: how CI plans `infra/billing`, how alert emails are addressed, and whether the opt-in kill switch ships with the budget. Verified against Google docs (2026-10-27):

- Reading a budget needs `billing.budgets.get` on the billing account. The narrowest predefined role is Billing Account Viewer, which also exposes all cost data on the account. Custom roles at billing-account level need an organization; Andy has none.
- By default, budget emails go to the billing account's Billing Account Administrators and Users. The alternative is up to 5 Cloud Monitoring email channels.
- There is no "send test alert"; the only test is lowering the budget below actual spend.
- The kill switch needs Pub/Sub, a deployed function with a Cloud Run admin identity, and a Needs-you flag that M1.2: Ticket core provides. That is past size S.

## Decision Outcome

| Question               | Decision                                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI and `infra/billing` | **Local plans only.** CI runs `fmt`/`validate`; `tf-plan` gets no billing-account role and no billing account ID secret is created. Exception to ADR-0011's "plans in CI" for this root only. |
| Alert recipients       | **Google's default IAM recipients** (Andy is billing admin). No email address in config; no Monitoring API.                                                                                   |
| Kill switch            | **New slice M1.14: Cost kill switch** (size M, depends on M1.2: Ticket core). Opt-in variable, default off. Not built in M1.13.                                                               |
| Cloud Run caps         | Request timeout 60s, concurrency 80 per instance (explicit default), max instances 2 (unchanged).                                                                                             |

### Consequences

- Good: no billing-account access for an identity any same-repo branch can use; nothing personal in config; M1.13 stays size S.
- Bad: budget drift isn't caught on PRs (Andy plans before each apply; this root rarely changes). No automatic shutdown until M1.14 lands; the billing runbook has a manual stop. Long MCP streams are cut at 60s (clients reconnect; raise if M1.1: MCP OAuth spike needs it).
