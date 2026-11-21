---
title: "Dependency agent: Dependabot PRs by class"
status: proposed (design; built in AI-157, AI-158, AI-163 to AI-167; Andy decides at review)
date: 2026-11-20
amends: 0042 (what auto-merges, who merges, bot merges deploy), 0092 (verified Actions bumps, if question 4 is yes)
---

# 0116 — Dependency agent: Dependabot PRs handled by class, for every managed project

AI-155: Dependency agent: design. Epic AI-154: Dependency agent. Andy, 2026-11-20: "there a bunch of open dependabot PRs, surprised those are not auto merged? Those should be handled agentically with this platform for all client projects."

## Context and Problem Statement

ADR-0042 auto-merges only npm patches and minors of 1.0+ packages, with the Actions `GITHUB_TOKEN`, after the ruleset's required checks. The week of 2026-11-16 showed its gaps:

| What happened                                                                                                                                            | Why                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Andy merged ten PRs by hand: Terraform providers, GitHub Actions bumps, majors.                                                                          | ADR-0042 leaves those classes to him and nothing prepares them.                                                           |
| PR #209 (grouped npm) bumped `@playwright/test`; the `ui-screenshots` container image stayed a version behind; the check failed and the PR still merged. | Auto-merge waits only for required checks; `ui-screenshots` isn't one. Coupled versions have no group and no drift check. |
| `main`'s screenshots stayed red two days; `main`'s checks and the deploy never ran on bot merges.                                                        | Merges made with `GITHUB_TOKEN` start no workflows; `deploy.yml` also skips bot actors.                                   |
| `terraform-plan` failed on Dependabot PRs (PR #214 now skips it).                                                                                        | Dependabot PRs can't read Actions secrets, so the plan has no credential.                                                 |

Every managed project (ADR-0096) gets the same Dependabot setup through the baseline (ADR-0031, ADR-0038), so each gap repeats per repo.

Terms. **Dependency agent**: the control plane's handling of Dependabot PRs: deterministic triage and merge code, plus agent tasks for majors. **Class**: the triage result, written as one PR label `deps:<class>`. **App token**: an installation token of the control plane's GitHub App, minted server side (key in Secret Manager, R19); it never enters Actions.

## Considered Options

| Option                                                                             | Consequences                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. The control plane triages and merges; agent tasks handle majors**             | One place for every repo (the App is already installed on each managed repo, ADR-0096); merges by the App start `main`'s workflows; majors reuse ticket → build → gate. The control plane sits in the merge path.      |
| B. Extend the Actions composite action (`dependabot-auto-merge`) with more classes | No control-plane change, but it still merges with `GITHUB_TOKEN` (no workflows on `main`), can't create tickets, can't merge workflow-file changes, and can't wait for non-required checks without polling in Actions. |
| C. Renovate (hosted app) instead of Dependabot                                     | Richer grouping and auto-merge rules, but a third-party app with write on every repo, a second config dialect, and it still can't fix a breaking major.                                                                |

## Decision Outcome

Option A.

### Triage by class

| Class              | What qualifies (all of)                                                                                                                                                                                                                            | Who merges, on what evidence                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm`              | Every dependency a patch, or a minor of a 1.0+ package (ADR-0042's rule); no new package with an install script; no `pnpm.onlyBuiltDependencies` change.                                                                                           | Control plane, App token, when **every** check run on the head is green (below). As today, plus non-required checks.                                               |
| `actions-verified` | Patch or minor Actions bump; each new SHA is the tagged release's commit in that action's repo, reachable from its branches or tags (not a fork-only "imposter" commit); release 7+ days old; action already used here; not on the Andy-only list. | Control plane, App token, every check green, **only if question 4 is yes**; otherwise Andy.                                                                        |
| `terraform`        | Provider patch or minor; lock-file hashes match the provider's signed `SHA256SUMS` on the registry; same version in every root.                                                                                                                    | Andy, after the agent's PR comment lists the per-root `terraform plan` commands and expected "No changes." (question 5).                                           |
| `major`            | Any major, or a 0.x minor, or an `npm` PR whose checks fail (a breaking change or coupled-version drift).                                                                                                                                          | An agent build task reads the changelog, fixes what breaks, opens one PR with bump and fix together; normal gate and both review agents; Andy merges (question 6). |
| `alert`            | Hand-written lockfile-only alert fix (ADR-0084).                                                                                                                                                                                                   | Coordinator, unchanged.                                                                                                                                            |
| `andy`             | A new install script; a diff touching `.github/workflows/` other than pin lines, `infra/**` other than lock files, a credential, secret or IAM path; anything that changes a plan; unreadable metadata; any verifier failure.                      | Andy. The comment says why.                                                                                                                                        |

The classifier lives in `packages/domain` (`classifyDependencyPr`, port of `scripts/dependabot-merge.mjs`), runs on the control plane's `pull_request` webhook for Dependabot PRs on registered repos, and re-runs on the head before any merge: the label is a display, never evidence. It reads Dependabot's commit metadata and the PR diff through the App (read). Andy-only Actions: auth (`google-github-actions/auth`), deploy, the review and executor actions (`anthropics/*`), and `dependabot/fetch-metadata`.

### Coupled versions

| Pair                                                  | Mechanism                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@playwright/test` and the Playwright container image | Drift check: Dependabot can't bump an image in a workflow `container:`. The failing check makes the PR `major`, and the agent bumps the image tag and digest. |
| Node (`.nvmrc`) and `@types/node` major               | Drift check (majors stay ignored by Dependabot, as today).                                                                                                    |
| Terraform providers across the four roots             | One Dependabot group across all `directories`, plus the drift check.                                                                                          |

The drift check is `scripts/coupled-versions.mjs` reading `.github/coupled-versions.json`, run by the `check` job (already required), so it gates every PR, human or bot. Cooldowns: 7 days for patch and minor (today), 14 for majors (`semver-major-days`).

### Which checks gate a bot merge

The control plane merges only when every check run and status on the head is completed with success, neutral, or skipped by its own path filter, and at least the ruleset's required checks are present. A check skipped because it lacks credentials on Dependabot PRs (`terraform-plan`, `agent-evals`) is not evidence of anything; classes that need it go to Andy. No ruleset change, so other PRs are unaffected (question 3).

### Merged bot PRs run `main`'s checks and the deploy

The App token merges (squash). Pushes by an App start workflows, so `ci.yml`, `security-scans.yml`, `ui-screenshots.yml` and `deploy.yml` run on `main`. `deploy.yml` drops its bot-actor skip for the App (question 2). Merging a PR that changes `.github/workflows/` needs the App's `workflows` permission (question 1).

| Option                       | Cost                                                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App token merge (chosen)** | One server-side merge call; Andy grants the App `workflows: write` if Actions bumps auto-merge. Every bot merge runs the full `main` pipeline: about 15 Actions minutes (free, public). |
| Nightly scheduled `main` run | A `schedule:` on `ci.yml` and `deploy.yml`; red `main` found up to a day late, and deploys wait a day. Kept as a cheap backstop only if Andy wants it.                                  |
| Merge queue                  | Runs checks on the merged result, but GitHub offers it only on organization-owned repos; this repo and managed repos are on a personal account (verify in AI-163).                      |

### Baseline and what Andy sees

| Carried to managed repos (ADR-0038)                  | How                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `template/.github/dependabot.yml`: groups, cooldowns | `managed` file (exists)                                                 |
| `.github/coupled-versions.json`                      | `seed` file, edited per repo                                            |
| `scripts/coupled-versions.mjs` in the `check` job    | composite action in `platform/actions/`, pinned                         |
| `dependabot-auto-merge.yml`                          | removed from `managed` once AI-163 ships; the control plane replaces it |
| Triage, merge, major tickets                         | the control plane, for any registered repo with the App installed       |

The daily digest (ADR-0081) gains a Dependencies section per project: merged by class, waiting on Andy with the reason, agent tasks against the weekly cap, Dependabot PRs open over 7 days. Waiting PRs show in Needs you.

### Caps (ADR-0028)

| Cap                                        | Value                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Agent tasks on dependency PRs, per project | 3 a week, one retry per PR (question 7); over cap, the PR waits in Needs you                  |
| Global                                     | Unchanged: these tasks count against the global cap, project dial, pause and quota (ADR-0079) |
| Dependabot PRs                             | Unchanged: 5 open per ecosystem, weekly                                                       |
| Triage and merge                           | Deterministic code, no quota; webhook-driven, so it scales to zero                            |

### Security

Planned rows: risk `R-AI-155` in the threat model, entry point and grants in `docs/security/agents-and-executors.md` (built in AI-157).

| Threat                                                                                                      | Bounded by                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A hijacked patch or minor passes every check and merges, now also deploying (R17 grows)                     | 7-day cooldown; `dependency-review`; no new install script; deploy is no-traffic smoke then traffic (ADR-0076); digest records each merge.                                                                                              |
| A compromised major, and an agent that "fixes" the build around it (edits code or tests to fit the payload) | 14-day cooldown; Andy merges majors; both review agents; the ADR-0092 tests rule (deleting or loosening a test is high risk); the agent may change only the bumped packages' lockfile entries; build sandbox has no secrets (ADR-0096). |
| Injected changelog or release notes steer the agent                                                         | Changelog is data; the agent's only output is a PR on its own branch; review agents read the diff, not the changelog.                                                                                                                   |
| Install script runs during the agent's build                                                                | pnpm runs dependency build scripts only when listed in `onlyBuiltDependencies`; any change to that list or a new scripted package is class `andy`.                                                                                      |
| Imposter or retagged Actions SHA                                                                            | Tag → SHA check in the action's own repo, reachability from its refs, Andy-only list for auth, deploy and review actions.                                                                                                               |
| Forged label or human push to a Dependabot branch                                                           | The merge re-classifies the head; only `dependabot[bot]` commits qualify; any other author makes it `andy`.                                                                                                                             |
| The App token merges more than before                                                                       | It already writes to every installed repo (R19); the merge path is code in `apps/api`, high risk to change (ADR-0092), and logs PR, head SHA and checks.                                                                                |

### Build slices

| Slice                                   | Scope                                                                                                        | Size | Depends on        | Risk | Done when Andy can check in minutes                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---- | ----------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| 1. Design (AI-155)                      | This ADR                                                                                                     | S    | —                 | high | He answers the open questions.                                                                                      |
| 2. Triage, shadow mode (AI-157)         | Classifier, webhook, label and comment; merges nothing; threat-model rows                                    | M    | 1                 | high | Every open Dependabot PR has one `deps:` label and a comment he agrees with.                                        |
| 3. Coupled versions and groups (AI-158) | Drift script and config; Terraform group across roots; 14-day major cooldown; template copy                  | S    | 1                 | high | Bumping `@playwright/test` alone on a branch fails `check` naming both versions.                                    |
| 4. App-token merge (AI-163)             | All-green rule, App merge, `deploy.yml` change, retire the Actions auto-merge; App permission per question 1 | M    | 2, **Andy** (App) | high | The next `npm` PR merges as the App and `main` shows CI and a deploy run for it.                                    |
| 5. Actions SHA verifier (AI-164)        | Tag → SHA, reachability, age, Andy-only list                                                                 | S    | 2                 | high | A fixture with a fork-only SHA is labelled `deps:andy` with that reason.                                            |
| 6. Majors as agent tickets (AI-165)     | Ticket per major PR, build on Dependabot's commit, close-with-link, weekly cap                               | M    | 2                 | high | A major PR becomes a ticket and an agent PR that passes the gate; the Dependabot PR is closed with a link.          |
| 7. Terraform prep (AI-166)              | Lock-hash check, plan-commands comment, Needs you                                                            | S    | 2                 | high | The weekly provider PR carries the commands; he runs them and merges.                                               |
| 8. Digest and baseline rollout (AI-167) | Digest section; manifest, §8.1 rows; runbook for a managed repo                                              | S    | 3, 4              | med  | The digest lists last week's dependency PRs by class; `baseline.mjs check` on a managed repo reports the new files. |

Slices 2 and 3 can run in parallel; 4 to 7 in parallel after 2.

### Consequences

- Good: routine updates in every managed repo land and deploy without Andy; majors arrive as fixed PRs, not chores; coupled versions can't drift silently; Andy sees all of it in one digest section.
- Bad: the control plane is in the merge path; if it is down, bot PRs wait (they don't merge wrongly).
- Bad: bot merges now deploy without Andy, widening R17.
- Bad: the App gains a new use (merging) and, if question 1 is yes, the `workflows` permission on every installed repo.
- Accepted: Terraform stays with Andy (if question 5 keeps it), about five minutes a week.

## Open questions for Andy

1. **May the control plane merge Dependabot PRs with the GitHub App's token, and should the App get the `workflows` permission for that?**
   This is a new merge right for automated code, on every managed repo. App merges start `main`'s checks and deploy; `GITHUB_TOKEN` merges start nothing. Merging a PR that edits `.github/workflows/` (every Actions bump) needs the App's `workflows` permission, a change Andy makes in the App settings and each install accepts.
   - App merge with `workflows`: all classes the control plane may merge get `main`'s pipeline; the App can then change workflow files anywhere it's installed (it can already push code there).
   - App merge without `workflows`: npm merges work; Actions bumps stay with Andy.
   - Keep `GITHUB_TOKEN` auto-merge plus a nightly `main` run: no new right; red `main` and deploys lag up to a day.
   - Recommendation: App merge with `workflows`, granted when AI-163 ships.

2. **Should merges by the App deploy the control plane (and managed apps) without Andy?**
   Today `deploy.yml` skips bot merges so prod changes only with Andy's next merge, which he may not inspect for it. The deploy already does a no-traffic smoke test before traffic (ADR-0076).
   - Deploy on bot merges: `main` and prod stay in step; a bad update reaches prod sooner, caught by the smoke test or rolled back.
   - Keep skipping: prod lags; a bad update ships later, bundled with Andy's unrelated change.
   - Recommendation: deploy.

3. **Should a bot merge wait for every check on the PR, or should more checks become required in the ruleset?**
   PR #209 merged with `ui-screenshots` red because only required checks gate GitHub's auto-merge. Required checks apply to every PR and, through the baseline ruleset, every managed repo, where `ui-screenshots` doesn't exist.
   - Control plane waits for every check (this ADR): no ruleset change; humans and the coordinator can still merge a red non-required check.
   - Add `ui-screenshots` and `sandbox-self-test` to required: every PR waits for them (a few minutes); needs a per-repo ruleset overlay in the baseline.
   - Recommendation: every check in the control plane now; add `ui-screenshots` to this repo's required list in a separate PR if red `main` recurs from human merges.

4. **May the control plane merge patch and minor GitHub Actions bumps whose SHAs it verified, though `.github/` is high risk (ADR-0092)?**
   Actions bumps are weekly, grouped, and today always Andy's. The verifier proves the SHA is the tagged release in the action's own repo and the release is 7+ days old; it can't prove the release itself is benign.
   - Yes, except auth, deploy, review and executor actions and any action new to the repo: most weekly Actions PRs merge without him.
   - No: Andy merges every Actions PR; the verifier's result is a comment that makes it a one-minute review.
   - Recommendation: yes, with the Andy-only list.

5. **Should Terraform provider PRs keep waiting for Andy's local plan, or should CI plan them with a credential granted to Dependabot PRs?**
   Plans need the plan service account, which reads state (state can hold secrets). A malicious provider binary runs with that credential during the plan. CI plans only `infra/control-plane`; `infra/billing` plans locally only (ADR-0029).
   - Andy plans (agent prepares): lock hashes verified, commands commented; about five minutes a week; no new grant.
   - CI plans bot PRs: Dependabot secret or variable copies plus a WIF condition for Dependabot branches; the control plane merges on "No changes." for the control-plane root only; other roots stay manual, and the group spans all roots, so it rarely helps.
   - Recommendation: Andy plans.

6. **After the agent fixes a major update and the PR passes the gate and both reviews, who merges it?**
   ADR-0092 makes a major version jump high risk, so Andy merges. The agent's fix is ordinary code, reviewed like any ticket PR.
   - Andy merges: one review per major, a few a month across projects.
   - Coordinator merges when green and medium otherwise: majors land without him; the agent-fixes-around-a-payload risk loses its human check.
   - Recommendation: Andy merges; revisit after ten clean majors.

7. **Is three agent tasks per project per week, with one retry per PR, the right cap for dependency work?**
   Majors and failed minors each take one build task (quota, minutes). Dependabot opens at most five PRs per ecosystem a week.
   - 3 a week, 1 retry: enough for a normal week; a burst waits a week in Needs you.
   - 1 a week: cheapest; majors queue.
   - No separate cap: only the global cap and quota (ADR-0079) bound it; a burst of majors could starve ticket work.
   - Recommendation: 3 a week, 1 retry.
