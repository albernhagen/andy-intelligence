# Threat model: Project agent tasks

`plan-project` and `ideate` as agent tasks (AI-134). Index: [threat-model.md](threat-model.md); risk: [R-AI-134](risks/R-AI-134.md). A project agent task is a run with no ticket: it reads the project's repo and returns the procedure's result (`platform/procedures/plan-project.md`, `ideate.md`); the control plane stores it.

## Entry points

| Entry point                                         | Who                       | What it does                                                                                  |
| --------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /api/projects/:id/plan/agent-task`            | Owner (`start_run`)       | Starts a plan-project task on the project's first repo                                        |
| `POST /api/projects/:id/ideate/agent-task` `{idea}` | Owner (`start_run`)       | Starts an ideate task; the idea (≤ 4,000 characters) is kept on the run for its report        |
| `/runs/:id/report` of such a task                   | Its own executor run only | Stores the result as `…/plan` or `…/ideate` would, as `agent:<runId>` (`requireOwnAgentTask`) |

## Trust boundaries

- **Read-only on every executor.** The executor workflow lists `plan-project` and `ideate` with refine, plan and review: read-only tools as flags and as managed settings (`platform/executor/profile.json`). It refuses any step that is neither on that list nor build or sync, before the agent job gets the model credential. The local runner runs only its own read-only list.
- **The idea, the brief and a rejected plan's reason are untrusted.** They enter the prompt after fixed text, JSON-escaped with `<` escaped, so they can't close their block. The procedures say they are data.
- **Agent output is untrusted.** It passes the same contract schema as the owner-only routes (`ProjectPlanProposal`, `IdeateSubmission`); a result that fails it fails the run and records nothing. A plan stays a proposal until Andy approves it. An idea opens at most a spec PR (`specs/<slug>.md`, Andy merges) under the hourly cap of 10.
- **The agent path's own rule.** `can` still refuses every agent. `requireOwnAgentTask` lets a run record only its own step's result, and only a run with no ticket. A replayed report records nothing twice: a plan already proposed by that run, or a ticket its `created` event names, is returned instead.

## Caps (ADR-0028)

One task of each step per project in flight; the project's dial and the global cap count them; the oldest wins a race. Strong tier, at most 50 (plan-project) or 40 (ideate) turns and a 45-minute deadline; never retried automatically.
