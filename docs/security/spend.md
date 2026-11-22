# Threat model: Paid model spend

Paid model calls and agent tasks (M10: Paid models + spend caps, ADR-0129, design: [`spend-and-caps.md`](../architecture/spend-and-caps.md)). Risk: [R-AI-227](risks/R-AI-227.md). PRs that change this area update this file. Today nothing is built: no paid provider, key or ledger exists.

## Credentials (planned)

| What               | Grants                                        | Where (planned)                                                                                                                                                      |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenRouter API key | Spend up to the key's credit limit, any model | Secret Manager (control plane), repo secret for the OpenCode workflow (AI-266: M10.15)                                                                               |
| Anthropic API key  | Spend up to the workspace spend limit         | Repo secret `ANTHROPIC_API_KEY`, read by the Claude executor only for `claude-api` runs (AI-260); key and limit: AI-267: M10.16. Risk: [R-AI-260](risks/R-AI-260.md) |

Never in the repo, a log, a prompt or the UI. Each provider limit is at or below our monthly cap.

## Threats

| Threat                                                               | Mitigation                                                                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runaway spend: a loop, retries or many tasks overnight               | Reserve before start against per-task, daily and monthly caps, atomically; refused means not started; provider limit as a second layer.                                        |
| A cap that silently doesn't apply (unreadable ledger, missing price) | Fail closed: no paid call; unknown usage and stale reservations count in full.                                                                                                 |
| A leaked key used outside the control plane                          | Provider limit bounds it; key only in Secret Manager or a repo secret; rotate per runbook.                                                                                     |
| Prompt injection steering a paid task to spend more                  | The per-task budget is set by the control plane from the reservation, not by the agent. The harness checks it between turns (a soft cap); the provider limit is the hard stop. |
| A project raising its own cap                                        | Project caps can only be lower than global; owner-only settings routes; every change is a ConfigChange.                                                                        |
