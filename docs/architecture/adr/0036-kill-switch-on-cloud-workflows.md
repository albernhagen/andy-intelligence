---
status: accepted
date: 2026-11-01
amends: 0028
---

# 0036 — The cost kill switch runs on Cloud Workflows, not a function

Decided by Andy, 2026-11-01 (M1.14: Cost kill switch).

## Context and Problem Statement

ADR-0028 sketched the kill switch as "budget → Pub/Sub → small function". A Cloud Run function needs Cloud Build, a source bucket and build permissions: more moving parts than the job warrants. The job is three API calls behind one comparison.

Verified (Google docs, 2026-11-01): manual scaling at 0 instances disables a Cloud Run service without creating a revision ("Service unavailable" for new requests); setting it back to automatic re-enables it. Budget notifications arrive several times a day, at least once, possibly out of order, with `costAmount` and `budgetAmount`; `alertThresholdExceeded` only reports configured thresholds.

## Decision Outcome

| Question       | Decision                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runner         | **Cloud Workflows** (YAML in `infra/billing/kill-switch.workflow.yaml`), started by an Eventarc trigger on the budget's Pub/Sub topic. No code to build or deploy.                  |
| Trip rule      | `costAmount / budgetAmount ≥ kill_switch_ratio` (1.5), computed in the workflow. Every step is idempotent, so duplicates are harmless.                                              |
| Action         | `control-plane` → manual scaling, 0 instances; pause every Cloud Tasks queue in the region. Never disable billing.                                                                  |
| Identity       | `cost-kill-switch` SA: custom project role (Cloud Run get/update + operations get, Cloud Tasks list/pause), `workflows.invoker`, `logging.logWriter`, actAs on the runtime SA only. |
| Where          | `infra/billing`, behind `kill_switch_enabled` (default false). Andy turns it on in his gitignored tfvars.                                                                           |
| Needs-you item | Deferred until M1.3: UI: tickets + inbox exists; the 150% budget email covers it.                                                                                                   |
| Test           | Publish a fake budget message to the topic: free, no need to lower the real budget.                                                                                                 |

### Consequences

- Good: no build pipeline; all in Terraform; about $0 to run.
- Bad: workflow logic has no unit tests; the fake-message test is its test. Manual scaling's launch stage isn't stated in the docs (the call sends `launchStage: BETA` as Google's example does); if Google changes it, the demo catches it. Anyone who can publish to the topic can trip the switch (only Andy and Cloud Billing today).
