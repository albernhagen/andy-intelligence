---
status: accepted
date: 2026-11-04
---

# 0051 — Claude Code executor: run protocol, permission profile, subscription billing

Built in M1.6a: Claude Code executor: dispatch + callback. Fills in §7.1, §7.2 and §9 where they left choices open.

## Context and Problem Statement

ADR-0050 starts the loop with the real `claude-code-action` on Andy's subscription. Open question 5 (is that billed and allowed?) had to be checked first. The design said "dispatch with the run ID, call back with OIDC" but not how the agent gets its instructions, how the agent's job is kept away from the callback credential, or how the permission profile resists a project's own `.claude/` settings.

## Decision Outcome

| Topic              | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing (OQ 5)     | Verified 2026-11-04 from Anthropic's docs: runs authenticated with `CLAUDE_CODE_OAUTH_TOKEN` "use your Claude subscription instead of API billing"; `claude setup-token` is documented for CI and scripts. Allowed for Andy's own runs on his own repos; not for running on behalf of other people. Advertised plan limits assume ordinary individual use, so caps stay on (one run in flight, max turns, timeouts). The token lasts one year. |
| Credential kind    | The executor takes it from the route's provider `billingType` (`subscription` → OAuth token, `pay_per_use` → `ANTHROPIC_API_KEY`). Provider billing lives in `PROVIDER_BILLING` (`@andy/domain`) until provider config moves to Firestore (M5: Epics + story board).                                                                                                                                                                           |
| Instructions       | Dispatch inputs are the run ID and the credential kind only (inputs are public in public repos). The workflow fetches the prompt from `GET /runs/{id}/context` with its OIDC token; the result goes to `POST /runs/{id}/report`.                                                                                                                                                                                                               |
| Caller identity    | At dispatch the Run records repo, executor workflow ref (`claude-executor.yml` on `main`) and the workflow run ID GitHub returns. Callbacks must match all three (`repository`, `job_workflow_ref`, `run_id` claims). Status changes are conditional, so a replay or late report is a no-op.                                                                                                                                                   |
| Job split          | Three jobs: `context` and `report` hold `id-token: write`; `agent` holds only the model credential and `contents: read`, so an agent with tools can't forge a report. The App needs Actions write to dispatch.                                                                                                                                                                                                                                 |
| Permission profile | `platform/executor/profile.json` + the step's rules + CODEOWNERS edit denies, written to `/etc/claude-code/managed-settings.json` from the platform's commit (not the project's). `allowManagedPermissionRulesOnly`, managed hooks only, no MCP servers, bypass and auto modes off, no reads or writes outside the checkout, secret files denied. Refine: Read, Glob, Grep.                                                                    |
| First step         | `refine` as a read-only report (ask, gaps, files, risks) on the ticket. M1.7: Refinement turns it into questions and a procedure doc; model per size is M1.8.                                                                                                                                                                                                                                                                                  |

### Consequences

- Good: no ticket text or secret in dispatch inputs; the agent job can't call back; a project can't loosen its own profile; switching to an API key is one constant and one secret.
- Bad: the prompt still shows in the job log (the action prints its inputs), public for public repos (threat model R22); managed settings need a live run to prove the CLI honours them; provider billing is code, not config, until M5.
