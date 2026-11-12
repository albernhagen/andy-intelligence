# 2026-11-12 — AI-105: M5.2: Run callbacks and push grant accepted from registered project repos

Built against ADR-0096's recommended answers (executor at `@main`; one repo per project; default branch `main`). Not affected by question 1 (where the Claude token lives).

- Dispatch (`packages/github/src/executor.ts`): the platform-only pin is gone; any repo the App is installed on, with default branch `main`, gets `agent-run.yml` dispatched. The run's repo is still the project's `repos[0]` (unchanged).
- Push grant (`apps/api/src/github/token.ts`): `TOKEN_POLICY` keeps only the system security review. Agent tasks go through `executorEntry`: `job_workflow_ref` is the platform executor at `refs/heads/main`, `workflow_ref` is the caller's own `agent-run.yml` on `main`, and the repo belongs to an enabled project (the webhook's 60-second `RepoIndex`). Then `claimPushGrant` checks the run as before.
- Callbacks and grant (`RunService.requireCaller`): besides repo, executor ref and workflow run, the repo must still be registered to the run's own project, so a run of project B never acts through project A's repo. One more project read per callback.
- Fail-closed on purpose (PR #196 review): the project check covers `context` and `report` as well as the push grant. A repo removed from its project mid-run can't report; the run ends at its deadline through the watchdog, which flags it, rather than trusting a repo the owner just removed. The 60-second `RepoIndex` cache on the token endpoint means a removed or disabled repo can still ask for a token for up to a minute; the run-level check reads the project live.
- Docs: R-AI-83 and the managed-repo caller row now say the checks are built; the token endpoint row in `entry-points-and-credentials.md` describes the executor rule.
- Nothing changes for project AI: its repo is registered, so its tasks pass the new rule. No Terraform, IAM, secret or App permission change.
