# Runbook: Verification run

The verify agent task after each deploy (AI-188: M6.7: Verification run, ADR-0159). Design: [`workflow.md` §4.6](../architecture/workflow.md#46-environments-and-release). Feature: [`verifying-stage.md`](../features/verifying-stage.md).

## The switch

| What            | Detail                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where           | `VERIFYING_SWITCH` in `packages/domain/src/verifying.ts`, one constant for every project                                                                |
| Who turns it on | Andy, by merging the AI-188 PR (high risk: only Andy merges it). Nothing else to set: it applies to projects whose deploy kind isn't `none`             |
| Turn it off     | A PR setting it to `false` (revert one line). Merges then go straight to Done again. Tickets already in Verifying stay there: move each to Done by hand |

## First live proof (Andy, once)

1. In a project with deploy kind `cloud-run`, merge a small code change. Its ticket goes to **Verifying**.
2. When `deploy.yml` finishes, open the ticket: a comment says "Verify task started … agent task <id>". The agent task page shows step `verify`.
3. Within 25 minutes the ticket moves to **Done** (pass) or **In progress** with Needs-you and the evidence (fail).
4. If nothing happens: see below.

## When a ticket is stuck in Verifying

Every ticket still in Verifying after 2 hours is flagged Needs-you. Look at, in order:

1. **The deploy:** did `deploy.yml` finish and report? `GET /api/projects/<id>/releases?env=dev` (or MCP `list_releases`) lists the deployment.
2. **Waiting:** the deployment's verification is `waiting` while a cap, the quota reserve, a pause or the spend gate holds it; it retries when any agent task ends. The reason is in the API logs (`component: "verification"`, `"verification waits"`).
3. **No merge commit:** a ticket merged before this shipped, or by a webhook GitHub didn't send, has none; logs say `"verifying ticket has no merge commit"`.
4. **The task failed** (schema, deadline, turns): the agent task page says why; another task starts when an agent task next ends, up to 3 per ticket, then Needs-you.

In every case, moving the ticket by hand (Done, or In progress) is safe: a later verdict leaves a ticket that already left Verifying alone.
