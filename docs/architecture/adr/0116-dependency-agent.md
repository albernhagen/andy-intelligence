---
title: "Dependency agent: Dependabot PRs handled by class"
status: proposed (AI-155; Andy decided the merge classes and the four questions on 2026-11-26; accepted when merged)
date: 2026-11-26
amends: 0042 (what auto-merges, who merges, bot merges deploy), 0124 (verified Actions pin bumps are not a kept kind)
---

# 0116 — Dependency agent: the control plane sorts Dependabot PRs by class and merges the safe ones itself

AI-155: Dependency agent: design, under epic AI-154: Dependency agent. Andy, 2026-11-26: npm patch/minor and SHA-pinned GitHub Actions bumps may merge on their own when checks pass; majors, Terraform providers and security alerts go to him. He wants this handled by the system and visible in the web app. Replaces the text of closed PR #218: docs: ADR-0116: Dependency agent, which Andy parked on 2026-11-25 as over-engineering; this version is smaller (no agent fixes majors, no CI Terraform plans).

## Decisions (Andy, 2026-11-26, on PR #460: AI-155: Dependency agent: design)

| #   | Question                                                       | Andy's answer | What it means here                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Grant the App `workflows` so Actions bumps merge on their own? | "grant it"    | Reading, not his words: the grant follows this ADR's sequence. Andy makes it by hand in the GitHub App settings (Permissions → Repository → Workflows: read and write; each installation accepts it) when AI-164: Dependency agent: verify GitHub Actions pin SHAs ships; that step goes in `docs/runbooks/github-app.md`. Until then Actions bumps are his click. |
| 2   | Should Dependabot merges by the App deploy?                    | "deploy"      | `deploy.yml` stays as it is; App merges deploy.                                                                                                                                                                                                                                                                                                                    |
| 3   | Should each major open a ticket?                               | "backlog"     | A capped Backlog ticket per major PR; nothing builds until Andy moves it.                                                                                                                                                                                                                                                                                          |
| 4   | Should `manual` merge mode stop Dependabot merges too?         | "yes"         | Under `manual` nothing merges without Andy, bumps included.                                                                                                                                                                                                                                                                                                        |

## Context and Problem Statement

Today ADR-0042 is built: `.github/workflows/dependabot-auto-merge.yml` calls `platform/actions/dependabot-auto-merge`, which runs `scripts/dependabot-merge.mjs` and, for npm PRs where every dependency is a patch or a minor of a 1.0+ package, runs `gh pr merge --auto --squash` with the job's `GITHUB_TOKEN`. Managed projects get the same workflow and `template/.github/dependabot.yml` through the baseline manifest. On 2026-11-26 four Dependabot PRs needed hand work:

| PR                                             | What happened                                                                                                                                                     | Gap                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Two routine bumps (one Actions group, one npm) | Andy merged them by hand.                                                                                                                                         | Actions bumps are manual under ADR-0042.                                                                                       |
| PR #437: Bump the minor-and-patch group        | `@playwright/test` moved to a new version; `ui-screenshots` runs in `mcr.microsoft.com/playwright:v1.65.1-noble` (pinned by digest); 126 screenshot tests failed. | Coupled versions move in separate places. `ui-screenshots` isn't a required check, so GitHub's auto-merge doesn't wait for it. |
| PR #428: Bump web-push from 3.6.7 to 4.0.0     | A major; its import shape changed.                                                                                                                                | Majors need a code change; nothing prepares one.                                                                               |

Also true today:

| Fact                                                                                                                                                                  | Source                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A merge made with `GITHUB_TOKEN` starts no workflows, so `main`'s CI and scans don't run for it; `deploy.yml` also skips `github-actions[bot]` and `dependabot[bot]`. | ADR-0042; `.github/workflows/deploy.yml`                      |
| Merges made with the control plane's GitHub App token start workflows and deploy (that is how `merge_pr` merges today).                                               | ADR-0124; `docs/security/coordinator-and-cloud-sessions.md`   |
| Dependabot PRs get no Actions secrets, so both review agents skip them by design (pass), and `terraform-plan` skips them.                                             | `platform/actions/agent-review-prepare`; `terraform-plan.yml` |
| The App has no `workflows` permission, so GitHub refuses App changes to `.github/workflows/**` (R-AI-113). Actions bumps edit those files.                            | `docs/security/entry-points-and-credentials.md`               |
| `.github/**` and `platform/actions/**` are kept paths: Andy merges them in every merge mode; only code (`mergeVerdict`) enforces it here (AI-380).                    | ADR-0124                                                      |
| Terraform provider PRs are not grouped across roots, so one provider version opens one PR per root.                                                                   | `.github/dependabot.yml`                                      |

Terms. **Class**: what the control plane decides a Dependabot PR is (table below), shown as one label `deps:<class>`. **Bot merge**: a merge into `main` that no person asked for. **App token**: an installation token of the control plane's GitHub App, minted on the server (R19).

## Considered Options

| Option                                                                                    | Consequences                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. The control plane classifies and merges, through the existing merge queue (chosen)** | One rule for every registered repo; the App's merge runs `main`'s checks and deploy; the merge queue already holds merges on a red `main` (AI-382), merges one PR per repo at a time and records each merge, so the web app and digest can show it. The control plane sits in the merge path. |
| B. Extend the Actions workflow (`dependabot-merge.mjs` gains Actions)                     | Smallest change, but `GITHUB_TOKEN` merges still run nothing on `main` and never deploy; GitHub's auto-merge waits only for required checks (PR #437 would still merge red); nothing reaches the web app.                                                                                     |
| C. Renovate instead of Dependabot                                                         | Better grouping, but a third-party app with write access to every repo and a second config format; it still can't fix a major.                                                                                                                                                                |

**Replace or extend:** A extends the rule and replaces the mechanism. `decide()` in `scripts/dependabot-merge.mjs` becomes a pure classifier in `packages/domain` with more classes; the Actions workflow, its composite action and the script are deleted once the control plane merges in this repo, and the baseline drops them for managed repos (below). Until then they keep working unchanged.

## Decision Outcome

Option A.

### Classes

The control plane classifies a Dependabot PR on its `pull_request` and `check_suite` webhooks, and again on the exact head just before merging. Inputs are GitHub facts only: changed files and their diff, commit authors, and the `updated-dependencies` block of Dependabot's own commit. Never the PR title, body or release notes.

| Class       | What qualifies (all of)                                                                                                                                                                                                                    | Who merges                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `npm`       | Every dependency a patch, or a minor of a 1.0+ package (ADR-0042's rule); only manifests and lockfiles change; no new package with an install script; no change to `pnpm.onlyBuiltDependencies`.                                           | Control plane, when every check passes (below).                                                     |
| `actions`   | Every change is a `uses: owner/repo@<sha> # vX.Y.Z` pin line; patch or minor; each new SHA is the commit of that tag in the action's own repo (not a fork-only commit); the action is already used in the repo; not on the Andy-only list. | Control plane, when every check passes and the App holds `workflows` (decision 1); until then Andy. |
| `major`     | Any major, or a 0.x minor.                                                                                                                                                                                                                 | Andy. The control plane opens a Backlog ticket for it (decision 3).                                 |
| `terraform` | Any Terraform provider bump.                                                                                                                                                                                                               | Andy, after planning each root locally.                                                             |
| `alert`     | A Dependabot security update PR.                                                                                                                                                                                                           | Andy. Hand-written lockfile-only alert fixes stay under ADR-0084.                                   |
| `andy`      | Anything else: a commit not by `dependabot[bot]`; a file outside manifests, lockfiles and pin lines; unreadable metadata; a failed SHA check; a coupled pair out of step.                                                                  | Andy, with the reason.                                                                              |

Andy-only Actions: `google-github-actions/auth` and anything else used in a job with `id-token: write`, `anthropics/*`, and `dependabot/fetch-metadata`.

The project's merge mode still decides (ADR-0124): under `manual` nothing merges without Andy (decision 4); under `low-risk`, `all-clean` and `epic`, `npm` and `actions` PRs merge into `main` directly. `actions` PRs touch kept paths; this ADR makes a pin-only diff with verified SHAs the one exception to the kept kinds. Any other line in `.github/**` or `platform/actions/**` keeps the PR for Andy.

### Coupled versions

| Pair                                                                                                                                                     | Rule                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@playwright/test` (`apps/web/package.json`) and the `ui-screenshots` image (`.github/workflows/ui-screenshots.yml`; `e2e/update-in-docker.sh` reads it) | Move in one PR. AI-394: Dependency bumps: Playwright image follows its package picks how; a drifted PR fails a required check that names both versions, so it never bot-merges. |
| `@types/node` major and `.nvmrc`                                                                                                                         | Unchanged: Dependabot ignores `@types/node` majors; Andy bumps both.                                                                                                            |
| One Terraform provider across all roots                                                                                                                  | One Dependabot group across the `directories` (AI-158), so Andy plans one PR per week, not one per root.                                                                        |

### Which checks gate a bot merge

| Rule                                                                                                                                                                                                                                        | Why                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Every check run and status on the head has finished as success, neutral, or skipped, and the ruleset's required checks are present. Not only the required ones.                                                                             | PR #437 merged-red risk; no ruleset change, so other PRs and managed repos are unaffected. |
| Skips that need secrets prove nothing: the review agents, agent evals and `terraform-plan` skip every Dependabot PR. Classes that would need them (`terraform`, `major`) go to Andy.                                                        | Dependabot PRs get no secrets (ADR-0030).                                                  |
| AI-394 may skip more jobs on lockfile-only Dependabot PRs, as AI-358 does for docs-only ones (`scripts/review-scope.mjs`), but never `check`, the security scans, dependency review, or `ui-screenshots` when a web app dependency changed. | Screenshots are the only test of a front-end bump; the Playwright drift showed up there.   |
| `main`'s required checks must be green (AI-382 merge hold).                                                                                                                                                                                 | A bot merge never lands on a red `main`.                                                   |
| The head need not contain the latest `main`: the queue doesn't sync Dependabot branches (a non-Dependabot commit would make the PR `andy`); Dependabot rebases its own PRs on conflict; `main`'s checks run after the merge.                | Same as today's GitHub auto-merge (ADR-0144: GitHub doesn't require up-to-date branches).  |

Note for AI-394: its third acceptance criterion ("review agents run as they do today" on majors and `infra/` or `.github/` changes) can't hold for a Dependabot PR, which has no secrets. Those classes go to Andy instead.

### How a bot merge runs `main`'s checks and deploy

The merge queue merges with the App token, squash, pinned to the judged head, as `merge_pr` does. Pushes by an App start workflows, so `ci.yml`, `security-scans.yml`, `ui-screenshots.yml` and `deploy.yml` run on `main`. `deploy.yml` needs no change: it skips only `github-actions[bot]` and `dependabot[bot]`, not the App (decision 2). For a `prod-only` project (project AI) that is a prod deploy through `cloud-run-safe-deploy` (no-traffic smoke test, then traffic; ADR-0076); for `dev-and-prod` it reaches dev, and prod waits for a promote (ADR-0114). A Dependabot merge has no ticket, so no Verifying stage. A red `main` after a bot merge holds every later merge (AI-382) and shows in Needs you.

### Managed projects (baseline, ADR-0031, ADR-0038)

| Piece                                                 | How it reaches a managed repo                                                                                                                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classify and merge                                    | Nothing to copy: the control plane does it for every registered repo with the App installed (ADR-0096).                                                                                                                                             |
| `template/.github/dependabot.yml` (groups, cooldowns) | Managed file, exists.                                                                                                                                                                                                                               |
| Coupled-version check                                 | A composite action in `platform/actions/`, pinned, called from the repo's `check` job; the pairs live in a seed file each repo edits.                                                                                                               |
| `dependabot-auto-merge.yml`                           | Removed from the manifest when the control plane merges. The baseline never deletes a written file and baseline PRs can't touch `.github/workflows/**`, so a runbook step tells Andy to delete each repo's copy (otherwise both paths would merge). |
| ARCHITECTURE §8.1 inventory row                       | With AI-167.                                                                                                                                                                                                                                        |

### What Andy sees

- **Daily digest (ADR-0081)**, one line per project with Dependabot activity: `Dependencies: 3 merged (npm 2, actions 1) · 2 wait for you: web-push 4.0.0 (major), google 8.11.0 (terraform)`. A bot merge followed by a red `main` adds `main red after <PR>`.
- **Needs you / Waiting for your merge (AI-218)**: every Dependabot PR left for Andy, with its class and reason. Terraform shows the per-root plan commands and the expected "No changes."
- **What's new**: bot merges listed by title as "no note" (as today), with class and verdict stored on the PR record (ADR-0124 "Record").

### Caps (ADR-0028)

| What                    | Cap                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Dependabot PRs          | Unchanged: weekly, 5 open per ecosystem, 7-day cooldown.                                                                                |
| Bot merges              | The merge queue's: one at a time per repo, 30 per project per hour; at most 10 bot merges per project per day, then they wait for Andy. |
| Classification          | Deterministic code on webhooks: no model calls, no quota; scales to zero. Webhook caps unchanged.                                       |
| Major tickets           | At most 3 opened per project per week; they stay in Backlog until Andy moves them, so no build starts on its own.                       |
| Deploys from bot merges | One per merge, inside the existing deploy caps.                                                                                         |

### Threat model

Risk [R-AI-155](../../security/risks/R-AI-155.md); R17 grows (bot merges now deploy).

| Threat                                                                                                                             | Bounded by                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A hijacked npm patch or minor passes every check, merges and now deploys                                                           | 7-day cooldown; dependency review, CodeQL, Trivy; no new install script; no review agents (no secrets, as today); safe deploy with smoke test; dev first for `dev-and-prod`; each merge in the digest; rollback.                               |
| A malicious Action release at the correct tag SHA runs in CI                                                                       | Patch/minor only; 7-day cooldown; tag → SHA in the action's own repo; action already in use; anything in an `id-token: write` job, review and executor actions and `fetch-metadata` stay with Andy.                                            |
| Granting the App `workflows` lets a stolen App key or a control-plane bug change workflows on every installed repo (R19, R-AI-113) | Kept-path refusal in code except pin-only diffs; baseline PRs still refuse `.github/workflows/**`; the grant is Andy's hand step, made only when the SHA check ships (decision 1); he can revoke it, and Actions bumps fall back to his click. |
| A person, or a stolen token, pushes to a Dependabot branch or forges a label                                                       | Classified from GitHub facts on the merged head; any commit not by `dependabot[bot]` makes it `andy`; labels are display, never evidence.                                                                                                      |
| Release notes or PR text steer the classifier or a major ticket                                                                    | Neither reads PR text; a major ticket is built from structured fields (package, versions, PR link), and its build agent treats the changelog as data.                                                                                          |
| The control plane is down or a fact can't be read                                                                                  | Nothing merges (fail closed); PRs wait in Needs you.                                                                                                                                                                                           |

### Remaining tickets of epic AI-154: Dependency agent

| Ticket                                                                            | Still needed? | Scope after this ADR                                                                                                  |
| --------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| AI-394: Dependency bumps: Playwright image follows its package (not in this epic) | Yes, first    | Coupled Playwright pair; lockfile-only skips, within the rules above.                                                 |
| AI-157: Dependency agent: triage Dependabot PRs by class (shadow mode)            | Yes           | Classifier in `packages/domain`, label, Needs-you reason; merges nothing. Absorbs AI-166.                             |
| AI-158: Dependency agent: coupled-version check and Dependabot groups             | Yes, smaller  | Generic coupled-version check and its baseline action; one Terraform group across roots. Playwright itself is AI-394. |
| AI-163: Dependency agent: merge green bot PRs with the App token                  | Yes           | `npm` merges through the queue; caps; retire the Actions workflow here.                                               |
| AI-164: Dependency agent: verify GitHub Actions pin SHAs                          | Yes           | Tag → SHA, pin-only diff, Andy-only list; `actions` merges once the App has `workflows`.                              |
| AI-165: Dependency agent: major updates become agent build tickets                | Yes, smaller  | Open a capped Backlog ticket per major PR; no automatic build or merge.                                               |
| AI-166: Dependency agent: Terraform provider PRs prepared for Andy                | No            | Folded into AI-157 (the Needs-you reason carries the plan commands). Cancel.                                          |
| AI-167: Dependency agent: digest section and baseline rollout                     | Yes           | Digest line, manifest change, runbook step to delete old workflows, §8.1 row.                                         |

Order: AI-394 and AI-157 in parallel → AI-158, AI-163, AI-164, AI-165 → AI-167.

### Consequences

- Good: routine bumps in every managed repo merge, run `main`'s checks and deploy without Andy; drifted pairs never merge; majors arrive as tickets; Andy sees it all in the digest and Needs you.
- Bad: the control plane is in the merge path; if it is down, bot PRs wait.
- Bad: bot merges now deploy without Andy (R17 grows).
- Bad: `actions` auto-merge needs the App's `workflows` permission on every installed repo, which removes GitHub's own block on App workflow edits.
- Accepted: Terraform, majors and alerts stay with Andy, about ten minutes a week per project.
