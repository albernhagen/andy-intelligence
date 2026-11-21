# Runbook: the `agent` environment for agent tasks' Claude token

AI-106 (ADR-0096 question 1). The executor's `agent` job (`claude-executor.yml`) names the GitHub environment `agent`. An environment secret is read only by a job that names the environment and runs on a branch the environment allows. Restricted to `main`, a workflow on another branch can't read the agent tasks' token this way. Do this in this repo first, then in each managed repo.

**Safe in either order with the merge.** Until step 3, a run uses the repo secret, exactly as before:

- GitHub creates an empty `agent` environment the first time a run names it.
- An environment secret wins over a repo secret of the same name only when the environment has one.
- The caller (`agent-run.yml`) still passes the secret by name; GitHub requires that for a reusable workflow.

So agent tasks never go without a token. If neither the environment nor the repo has it, the agent job's first step, "Check the model credential", fails the run with that reason, and the ticket shows it.

## Steps (per repo, about 5 minutes)

| #   | Where                                        | Do                                                                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Repo → Settings → Environments               | Open `agent` (it exists once a run has named it), or **New environment** `agent`.                                                                                                                                                                                                                               |
| 2   | `agent` → Deployment branches and tags       | **Selected branches and tags** → add rule `main`. Leave required reviewers and wait timer off (an agent run must not wait).                                                                                                                                                                                     |
| 3   | Your Mac, then `agent` → Environment secrets | Run `claude setup-token` and add the token as `CLAUDE_CODE_OAUTH_TOKEN`. GitHub can't show the repo secret's value, so this is a new token. For pay-per-use later (AI-267: M10.16), add `ANTHROPIC_API_KEY` here, not as a repo secret.                                                                         |
| 4   | Projects page                                | Start one refine on a ticket. In the Actions run, the `agent` job shows environment `agent` and "Check the model credential" passes.                                                                                                                                                                            |
| 5   | —                                            | **Keep the repo secret `CLAUDE_CODE_OAUTH_TOKEN`.** The review agents (`security-review.yml`, `adversarial-review.yml`, the system review and agent evals; managed repos get the first two from the baseline) run on PR branches. They can't use a `main`-only environment, so they still read the repo secret. |

Rotating: replace the environment secret (step 3); the repo secret separately.

## Private repos

On GitHub Free, a private repo can't configure environments: environment secrets and branch rules are ignored. The agent job then reads the repo secret the caller passes, as before step 3. Either upgrade to GitHub Pro (about $4 a month) and follow the steps, or keep the token as a repo secret only (R2 applies: any workflow on any branch there can read it).
