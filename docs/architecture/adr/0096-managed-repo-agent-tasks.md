---
status: proposed (design; built in AI-105, AI-106, AI-111; Andy decides at review)
date: 2026-11-12
amends: 0051 (agent tasks run in a registered project's repo, not only this one), 0063 (the push grant for a managed repo), 0038 (the executor is called at `main`, not a pinned SHA)
---

# 0096 — Managed-repo agent tasks: a caller in each repo, one platform executor

AI-83: M5.1: Managed-repo runs: design. Slice 1 of M5: Multi-project in parallel's managed-repo work; AI-105: M5.2: Run callbacks and push grant from registered repos, AI-106: M5.3: Caller workflow for managed repos in the baseline and AI-111: M5.4: First managed project live build it.

## Context and Problem Statement

Agent tasks (refine, plan, build, sync) run only in `albernhagen/andy-intelligence`. Two pins hold that today:

| Pin                 | Where                                                                                                                              | What it refuses                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Dispatch            | `PLATFORM_REPO` in `packages/github/src/executor.ts`                                                                               | `start` throws for any other repo, or a default branch other than `main`                       |
| Push grant          | `TOKEN_POLICY` in `apps/api/src/github/token.ts`                                                                                   | `POST /github/token` from any workflow but this repo's `agent-run.yml` → `claude-executor.yml` |
| Callbacks (already) | `RunService.requireCaller` (`packages/domain/src/runs.ts`): OIDC `repository`, `job_workflow_ref`, `run_id` = the run's `executor` | A `context` or `report` call from any workflow run the task wasn't dispatched to               |

A registered project's repo (a **managed repo**) must run agent tasks with the same guards, and every other repo must stay refused. Terms: **caller**: the managed repo's `.github/workflows/agent-run.yml`, which the control plane dispatches; **executor**: this repo's reusable `claude-executor.yml`; **registered**: listed in an enabled project's `repos` (a repo belongs to at most one project, `ProjectService.register`).

## Considered Options

| Option                                                                                                                       | Consequences                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Thin caller in each managed repo; it calls `albernhagen/andy-intelligence/.github/workflows/claude-executor.yml@main`** | One executor for every repo: profile, sandbox, publish checks and procedures come from the platform; callbacks check one `job_workflow_ref`. The repo holds its own Claude credential.        |
| B. The caller pins the executor to a commit SHA (like ADR-0038's composite actions)                                          | Old executors keep running after a fix; the control plane would have to know each repo's expected SHA to check `job_workflow_ref`. Open question 2.                                           |
| C. Agent tasks for every project run in this repo's Actions and push across repos                                            | No setup per repo, but one workflow would need tokens for every repo, the agent checks out a repo its workflow doesn't own, and this public repo's logs would show private projects' prompts. |

## Decision Outcome

Option A.

### Who is accepted

| Call                                         | Accepted only when (all of)                                                                                                                                                                                                                                                                                                                                                                                        | Refused otherwise                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Dispatch (`ClaudeCodeActionsExecutor.start`) | The run's project is enabled and the repo is its `repos[0]`; the App is installed on it (`getRepo`); its default branch is `main`. Dispatches `agent-run.yml` on `main`.                                                                                                                                                                                                                                           | Run fails with the reason, e.g. "the App isn't installed on owner/name" |
| `context`, `report` callbacks                | OIDC verified (issuer, audience, signature, expiry); `repository`, `job_workflow_ref` and `run_id` equal the run's recorded `executor` (unchanged: dispatch records `repo` = the managed repo, `ref` = `CLAUDE_EXECUTOR_REF`).                                                                                                                                                                                     | `403`, logged with the claims                                           |
| Push grant (`POST /github/token`, `runId`)   | Executor rule replaces the one static entry: `job_workflow_ref` = `CLAUDE_EXECUTOR_REF`; `workflow_ref` = `<repository>/.github/workflows/agent-run.yml@refs/heads/main`; `repository` registered to an enabled project (lookup cached 60 s, like the webhook `RepoIndex`); then `claimPushGrant`: the run is a build or sync in flight, dispatched to this caller, its project still lists the repo, first grant. | `403` before the rate cap is spent on it; logged                        |
| Push token                                   | `issueRepoToken(repository)`: contents and pull requests write on that one repo, 1 hour (unchanged).                                                                                                                                                                                                                                                                                                               | —                                                                       |
| Other `TOKEN_POLICY` entries                 | The system security review stays this repo only.                                                                                                                                                                                                                                                                                                                                                                   | —                                                                       |

A repo that isn't registered gets nothing: no dispatch goes to it, its callbacks match no run, its token request matches no rule. A registered repo's other workflows, branches or forks don't match `workflow_ref` or the run's `run_id`. Local runs (ADR-0089) follow the same rule: the push token is for the run's project's repo only.

### The caller and the executor

- **Caller** (`template/.github/workflows/agent-run.yml`, carried by the baseline, AI-106): `workflow_dispatch` with `run_id` and `credential`; `permissions: {}` at the top, `contents: read` and `id-token: write` on the one job; `uses: albernhagen/andy-intelligence/.github/workflows/claude-executor.yml@main`; passes the Claude credential (open question 1). `baseline.mjs check` reports drift in it (R5).
- **Executor:** unchanged. It already checks out `platform/` from this repo at the OIDC `job_workflow_sha`, never from the managed repo, and sets up pnpm and Node only when the repo has `pnpm-lock.yaml` and `.nvmrc`. Other toolchains get no install step: their build agent can edit but not run the project's checks. Fine for M5.4's first repo if it is a pnpm repo; other toolchains are later work.
- **Why `@main`:** the callbacks and grant check one `job_workflow_ref`; a fix here reaches every repo at once (open question 2).

### Credential

The managed repo holds its own Claude credential: `CLAUDE_CODE_OAUTH_TOKEN` (subscription) or `ANTHROPIC_API_KEY` (pay per use), the same names the executor reads. The control plane never holds or relays it (a cross-job hand-off in Actions would expose it). Where it lives in the repo is open question 1.

### Adding a repo to a project

One repo per project for agent tasks in M5 (`repos[0]`, open question 3). The order, each step a guard: the App installed on the repo (GitHub, Andy) → the project registered with that repo (UI, owner only, recorded) → the caller on `main` (baseline PR, Andy merges) → the credential (Andy) → builds switched on (`buildEnabled`, owner only). Registering is now also a token-policy change made without a PR (R19 said policy changes need one); the two independent steps by Andy (install, register) replace that review.

### Andy's steps per new repo (AI-111: M5.4: First managed project live)

| #   | Step                                                                                                                                               | Costs or grants                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Create or pick the repo on his account; default branch `main`.                                                                                     | Private repo: Actions minutes from his plan's free allowance (public: free) |
| 2   | Install the GitHub App on it (GitHub → the App → Configure → add the repo). No App permission change.                                              | The App key now writes there too (R19)                                      |
| 3   | Settings → Actions → General: allow reusable workflows from `albernhagen/andy-intelligence`; workflow permissions read-only by default.            | —                                                                           |
| 4   | Register the project in the UI with that repo.                                                                                                     | Opens it to dispatch and the push grant                                     |
| 5   | Merge the baseline PR with `agent-run.yml` (AI-113: M5.14 opens it; until then copy the template file), then `baseline.mjs apply` for the ruleset. | —                                                                           |
| 6   | `claude setup-token`, then add it as `CLAUDE_CODE_OAUTH_TOKEN` where open question 1 says.                                                         | A secret; one more copy of his subscription token                           |
| 7   | Run one refine on a ticket, then switch builds on for the project.                                                                                 | Quota, under the existing caps                                              |

### Caps (ADR-0028)

No new cap: spend scales with agent tasks, not repos, and the global cap, per-project dial, pause and quota reserve (ADR-0079) apply to every project. One push token per build or sync run. Token requests stay at 30 a minute per instance; the registered-repo lookup is cached, so a request costs at most one project listing a minute.

### Security

New trust boundary per managed repo: whoever can push to it or change its settings (Andy; later its collaborators) controls its caller, secrets and other workflows. Planned rows: entry point in `docs/security/agents-and-executors.md`, risk `R-AI-83` in the threat model.

| Attacker has                                  | Gains                                                                                                                                | Bounded by                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Any repo not registered, calling the executor | An OIDC token naming its own repo: nothing.                                                                                          | Every check above names a registered repo or a dispatched run.                                                                    |
| Push access to a managed repo                 | Its Claude credential (any workflow there can read a repo secret, R2), its `GITHUB_TOKEN`; an edited caller still runs our executor. | Open question 1 (environment on `main`); no push grant without a dispatched build; ruleset on `main`.                             |
| A malicious merge to this repo's `main`       | Runs in every managed repo with its credential, at once (`@main`).                                                                   | `.github/` and `platform/` are high risk: Andy merges; all PR reviews and scans; R10.                                             |
| The App key (R19)                             | Write on every installed repo; now more repos.                                                                                       | Secret Manager, one reader; install only on registered repos; rotation runbook.                                                   |
| An injected ticket in a managed project       | What it has here: the sandboxed checkout, registry network, a PR on `agent/<KEY>/<run>`.                                             | Profile, sandbox, publish checks from the platform commit; the managed repo's ruleset and review agents; Andy or the gate merges. |

### Build slices

| Slice                                  | Scope                                                                                                                                                                                                                                        | Size | Depends on                                 | Risk | Done when Andy can check in minutes                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Design (this ADR, AI-83)            | ADR-0096, planned rows, slice table                                                                                                                                                                                                          | S    | —                                          | high | He reads it and answers the open questions.                                                                                                                             |
| 2. Callbacks and push grant (AI-105)   | Drop `PLATFORM_REPO` from dispatch (keep the `main` and App checks); the executor rule in `token.ts` with the registered-repo lookup; `claimPushGrant` re-checks the project owns the repo; tests for each refusal; threat model rows built. | M    | 1                                          | high | `token.test.ts` shows a registered repo's executor getting one token and an unregistered repo, another workflow file, another branch and a second request each refused. |
| 3. Caller in the baseline (AI-106)     | `template/.github/workflows/agent-run.yml`, manifest entry, `check` drift; credential passing per open question 1                                                                                                                            | S    | 1                                          | high | `baseline.mjs check` on this repo reports the caller; the template's file differs from this repo's only in `uses:`.                                                     |
| 4. First managed project live (AI-111) | Andy's steps 1 to 7; runbook `managed-project.md`; README; one refine, then one build PR in the new repo                                                                                                                                     | S    | 2, 3, **Andy** (repo, App install, secret) | high | A ticket in the new project goes Ready → PR in its repo, and the task's callbacks show in the logs with that repo's name.                                               |

Slices 2 and 3 can run in parallel.

### Consequences

- Good: one executor, profile, sandbox and publish path for every repo; a registered repo opens only through Andy's two steps; unregistered repos stay refused by the same checks that guard this repo today.
- Good: each repo's prompts and logs stay in that repo (private repos keep them private).
- Bad: one bad merge to this repo's `main` reaches every managed repo at once.
- Bad: a copy of the Claude token per repo; rotating it means updating each.
- Bad: registering a repo changes who may get a push token without a PR.
- Accepted: repos named by owner/name, not GitHub's repo ID; reusing a name needs Andy's account, which already holds more.

## Open questions for Andy

1. **Should a managed repo keep its Claude token in a repo secret, or in an environment that only the `main` branch can use?**
   Any workflow on any branch of a repo can read a repo secret (R2, which planned "environments with branch rules before M5"). An environment secret is read only by a job that names the environment and runs on an allowed branch; in a reusable workflow it comes from the caller repo's environment.
   - Repo secret: Andy adds one secret per repo; the caller passes it; no executor change. A workflow on a pushed branch there can read it.
   - Environment `agent` limited to `main`: the executor's `agent` job names it (a `.github/` change, here too, so this repo gets the environment and its secret first); the caller passes no secret. Private repos need GitHub Pro for environments (about $4 a month); public repos don't.
   - Recommendation: environment `agent` on `main`, built in AI-106; if the first managed repo is private and he'd rather not pay for Pro, a repo secret until then.

2. **Should managed repos call the executor at `main`, or at a commit SHA that Dependabot bumps?**
   ADR-0038 pins composite actions to SHAs so a merge here can't change a managed repo by itself. The executor is different: the control plane checks its exact `job_workflow_ref`.
   - `@main`: one ref to check; fixes reach every repo at once; a bad merge does too (Andy merges `.github/`).
   - SHA per repo: a bad merge waits for each repo's Dependabot PR; the control plane must store each repo's expected ref, and old executors keep running until bumped.
   - Recommendation: `@main`.

3. **Should a project run agent tasks in one repo, or may it hold several and pick one per ticket?**
   `Project.repos` is a list, but dispatch already uses only `repos[0]`, and a repo belongs to at most one project.
   - One repo per project: no new field; a second repo is a second project. Cross-repo work waits on AI-96: M5.17: Cross-project dependencies.
   - Several: a ticket `repo` field, the UI to pick it, dispatch and the grant keyed on it; one more M slice.
   - Recommendation: one repo per project for M5.
