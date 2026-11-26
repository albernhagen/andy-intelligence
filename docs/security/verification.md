# Threat model: Verification run

The `verify` agent task (AI-188: M6.7: Verification run, ADR-0159). Index: [threat-model.md](threat-model.md); risk: [R-AI-188](risks/R-AI-188.md). After a deploy to a project's first environment, one task with no ticket checks the deployed app against the Verifying tickets it contains, by `platform/procedures/verify.md`, and its verdict moves them.

## Entry points

| Entry point                                | Who                                                 | What it does                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /deployments/{id}/finish` (existing) | The project's own `deploy.yml` on `main` (ADR-0019) | Now also starts the verify task, or sends the tickets back when the deploy failed. Runs once per deployment (a second finish is `409`) |
| `GET /runs/{id}/context` of a `verify` run | Its own executor run only                           | Adds `verify`: the deployment's URL and commit, read from the run's own project's deployment                                           |
| `POST /runs/{id}/report` of a `verify` run | Its own executor run only                           | Moves only the tickets the run was given and that are still in Verifying                                                               |
| `pull_request` webhook (existing)          | GitHub, signed                                      | Now keeps a merged PR's `merge_commit_sha` on the ticket's PR link; only for merged PRs and only a 40-hex value                        |

## Trust boundaries

- **The deployed app is untrusted.** Its pages, headers and errors can say anything. The procedure treats them as evidence, never instructions, and an attempt to steer it fails the criterion it was checking.
- **Read-only by construction.** Managed settings (`platform/executor/profile.json`, step `verify`) and the action's flags allow Read, Glob, Grep and `WebFetch(domain:<deployed host>)` only; Bash, Edit, Write, WebSearch and Task are denied. No shell means no write, no other host and no request but WebFetch's `GET`, so prod is not written.
- **The host is checked before the agent gets a credential.** The context job refuses a `verify` context without an `https` URL whose host is a plain DNS name (no user info, port, single label such as `localhost`, or IP address: the last label must start with a letter), with a ticket or branch, or over 30 turns; `executor-profile.mjs` refuses the step without a valid host. Other steps with a `verify` field are refused.
- **The checkout is the deployed commit,** read-only to the agent.
- **Ticket text is untrusted.** It goes into the prompt as JSON inside `<verify-data>`, `<` escaped, criteria capped at 20 per ticket and 500 characters each, the prompt under 95,000 characters.
- **The verdict is untrusted.** It must match the executor's JSON schema and the domain's `VerifyVerdict` (each verdict follows from its parts), and may name only the task's own tickets; otherwise the run fails and nothing moves. The evidence comment is capped at 6,000 characters, flattened, and labelled model-written.

## Caps (ADR-0028)

| What        | Cap                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Tasks       | One per deployment; one per project in flight; project dial, global cap, pause, quota reserve and spend gate like any task    |
| Turns, time | 30 turns; agent step 20 minutes; run deadline 25 minutes (the watchdog ends it)                                               |
| Tickets     | 50 per task, fewer if the prompt is full; 3 verify tasks per ticket per entry into Verifying, then Needs-you                  |
| Reads       | Per deploy: one Verifying ticket list, and per ticket (at most 50) one PR link read, one event list and one code-host compare |
| Retries     | On each agent task's end: one project list and one deployment read per deploying project                                      |

## Credentials

None new. Compares use the connected GitHub App; the agent gets the model credential only, as other read-only steps do.
