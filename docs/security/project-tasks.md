# Threat model: Project agent tasks

`plan-project` and `ideate` as agent tasks (AI-134), and `plan-epic` (AI-383, ADR-0155). Index: [threat-model.md](threat-model.md); risks: [R-AI-134](risks/R-AI-134.md), [R-AI-383](risks/R-AI-383.md). A project agent task is a run with no ticket: it reads the project's repo and returns the procedure's result (`platform/procedures/plan-project.md`, `ideate.md`); the control plane stores it.

## Entry points

| Entry point                                                                                     | Who                       | What it does                                                                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST /api/projects/:id/plan/agent-task`                                                        | Owner (`start_run`)       | Starts a plan-project task on the project's first repo                                          |
| `POST /api/projects/:id/ideate/agent-task` `{idea}`                                             | Owner (`start_run`)       | Starts an ideate task; the idea (≤ 4,000 characters) is kept on the run for its report          |
| MCP `start_plan_project`, `start_ideate` (AI-320)                                               | Owner (`start_run`)       | The same service as the two routes, same checks and refusals                                    |
| `/runs/:id/report` of such a task                                                               | Its own executor run only | Stores the result as `…/plan` or `…/ideate` would, as `agent:<runId>` (`requireOwnAgentTask`)   |
| `POST …/tickets/:id/breakdown/agent-task`, MCP `start_epic_breakdown`                           | Owner (`start_run`)       | Starts a plan-epic task on a top-level epic in an approved milestone                            |
| `POST …/tickets/:id/breakdown`, MCP `submit_epic_breakdown`                                     | Owner (`start_run`)       | Stores a hand-drafted breakdown as the proposal                                                 |
| `POST …/tickets/:id/breakdown/decision`, MCP `approve_epic_breakdown` / `reject_epic_breakdown` | Owner (`decide_plan`)     | Creates the drafted tickets in Ideas, or records the send-back note                             |
| `/runs/:id/report` of a plan-epic task                                                          | Its own executor run only | Stores the breakdown as `agent:<runId>`, only for the epic the run is on (`requireOwnEpicTask`) |

## Trust boundaries

- **Read-only on every executor.** The executor workflow lists `plan-project` and `ideate` with refine, plan and review: read-only tools as flags and as managed settings (`platform/executor/profile.json`). It refuses any step that is neither on that list nor build or sync, before the agent job gets the model credential. The local runner runs only its own read-only list.
- **The idea, the brief and a rejected plan's reason are untrusted.** They enter the prompt after fixed text, JSON-escaped with `<` escaped, so they can't close their block. The procedures say they are data.
- **Agent output is untrusted.** It passes the same contract schema as the owner-only routes (`ProjectPlanProposal`, `IdeateSubmission`); a result that fails it fails the run and records nothing. A plan stays a proposal until Andy approves it; approval stores each milestone's case (ADR-0149) on a milestone his approval of the plan approves. Cases are plain text in the UI and "data, never instructions" in MCP tool descriptions. An idea opens at most a spec PR (`specs/<slug>.md`, Andy merges) under the hourly cap of 10.
- **The agent path's own rule.** `can` still refuses every agent. `requireOwnAgentTask` lets a run record only its own step's result, and only a run with no ticket. A replayed report records nothing twice: a plan already proposed by that run, or a ticket its `created` event names, is returned instead.

- **plan-epic (AI-383).** It is read-only like the others, and listed in the workflow and the profile. The epic's text, its milestone's case, its children's titles and Andy's send-back note enter the prompt in one `<epic-data>` block, JSON-escaped with `<` escaped. The result passes `EpicBreakdownProposal`: every field is capped, there are at most 12 tickets, never an epic, and no blocker cycle. It stays a proposal until Andy approves it, and approval only creates tickets in Ideas. Nothing builds, and refine doesn't start until Andy moves them.

## Caps (ADR-0028)

One task of each step per project in flight; the project's dial and the global cap count them; the oldest wins a race. Strong tier, at most 50 (plan-project) or 40 (ideate) turns and a 45-minute deadline; never retried automatically. plan-epic: one per epic in flight, 3 dispatched per epic in all, 12 tickets per proposal, 40 turns, 45 minutes, never retried.
