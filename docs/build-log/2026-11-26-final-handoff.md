# 2026-11-26 — Final review and handoff

The build-out Andy approved is finished. This entry records where andy-intelligence stands before the first managed project. Earlier review: [2026-11-23 outcome](2026-11-23-review-outcome.md). Terms: [glossary](../architecture/glossary.md).

## What is built

| Milestone                                                                                          | State                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| M1: First end-to-end flow, M2: Self-hosting, M3: New UI and MCP, M11: Design system and UI rebuild | Every ticket Done                                                                                                                 |
| M4: Epics + ticket board                                                                           | Left: AI-129: M4.23: First overnight run trial                                                                                    |
| M5: Multi-project in parallel                                                                      | Left: AI-111: M5.4: First managed project live, AI-384, AI-385. Cloud worker sessions proven (AI-151, PR #457)                    |
| M6: Dev → prod releases                                                                            | Left: AI-210: M6.20: First project on dev + prod. The Verifying stage is on for projects whose deploy kind isn't `none` (PR #455) |
| M10: Paid models + spend caps                                                                      | Built and off; the three key tickets (AI-266, AI-267, AI-269) are parked                                                          |
| M7: Mobile, M8: Project members, M9: Add Jules + model routing                                     | Parked, partly built                                                                                                              |

## Architecture as it stands

- One Cloud Run service (API, MCP, webhooks, web app) that scales to zero; Firestore holds state; GitHub Actions runs agent tasks.
- A managed project gets a baseline PR and, for deploy kind `cloud-run`, its own Terraform root from three modules: `project-env`, `project-budget`, `project-alerts`.
- Guardrails: a cap on everything that spends, a merge gate with merge modes, two review agents on every PR.
- The process is heavier than the code: 144 ADRs, 84 MCP tools kept in step with the web app by a test.

## Product, end to end

Idea → discovery → brief → milestone plan → epic drafted into tickets → refine → build → review → merge → deploy → verify → promote or roll back, in the web app and over MCP.

**Never run live:** the dispatcher and gate building a ticket (project AI was built by desktop sessions; its first control-plane refine task ran on 2026-11-26), the merge queue, `deploy.yml` and promote or rollback in a managed repo, the Verifying stage, a night run. The first managed project tests all of them.

## Terraform drift check (2026-11-26)

| Root or module                                         | Result                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Four roots, three modules, two template roots (`main`) | `terraform fmt` and `validate` pass; 36 plan-only tests pass                                                   |
| `infra/control-plane`                                  | Andy's plan after applying PR #443: 0 to add, 1 to change (the revision reset after a CI deploy), 0 to destroy |
| `infra/billing`                                        | Only a new empty output (`managed_project_kill_switch_topics`); no resource change                             |
| `infra/dns`                                            | First plan failed for a missing Cloudflare token; Andy reports it applied since. Plan output not seen here     |
| `infra/bootstrap`                                      | Andy reports no changes. Plan output not seen here                                                             |

Only `infra/control-plane` has a plan in CI (weekly, in the system security review).

## Next, in order

1. AI-111: M5.4: First managed project live, merge mode `low-risk`, prod-only first (runbook `managed-project.md`).
2. On that project: the first live check of the Verifying stage (runbook `verification.md`), then AI-210 and AI-129.
3. Later, Andy's call: AI-384, AI-385, AI-394 (dependency bump checks), AI-397 (MCP backward moves), unparking M7, M8 or M9.

Keep project AI's deploy kind at `none` until the Verifying stage is proven on the managed project: the control plane's own deploy workflow has not been checked against it.

## Open risks

- A managed repo must pin actions to a commit SHA but calls the executor at `@main`; untested.
- GitHub does not enforce code-owner review on kept paths (AI-380); only `mergeVerdict` refuses them.
- Desktop sessions need the Mac awake. Cloud sessions avoid that; a clean start with the corrected setup command is not yet proven.
- AI-393: Every project has a logo is Done, but copying the logo to the project's repo and drafting options have no ticket.
- Cloud worker sessions get every connector connected in claude.ai (Gmail, Calendar, Drive), not only `andy-intelligence` (risk R-AI-149-2); Andy decided on 2026-11-26 to keep them; the risk stays open.
- Two Dependabot PRs stay open: PR #437 (needs AI-394) and PR #428 (web-push 4.0 breaks its import; only M7: Mobile uses it).
