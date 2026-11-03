---
status: accepted
date: 2026-11-03
amends: 0031
---

# 0042 — Dependabot auto-merge for patch and minor updates; CODEOWNERS requests Andy's review

Decided by Andy, 2026-11-03.

## Context and Problem Statement

Dependabot opens grouped weekly PRs (ADR-0025, ADR-0030). Andy merges each by hand, and he got no notification when they opened. The baseline set `allow_auto_merge: false` (ADR-0031).

Facts (GitHub and fetch-metadata docs, 2026-11-03):

| Topic                    | Fact                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Update type              | `dependabot/fetch-metadata` (v3.1.0) gives `update-type`; for a grouped PR it is the highest semver change in the group.                                                              |
| Token                    | A `pull_request` workflow on a Dependabot PR gets the write scopes its `permissions:` asks for; it gets only Dependabot secrets, so the review agents skip Dependabot PRs (ADR-0030). |
| Merges by `GITHUB_TOKEN` | Events caused by `GITHUB_TOKEN` start no new workflow runs, so the merge's push to `main` doesn't run `deploy.yml` (to confirm in the first auto-merge).                              |
| Review requests          | Dependabot's `reviewers` option was replaced by CODEOWNERS. A code owner is requested on every PR that touches owned files, except the PR's own author.                               |

## Decision Outcome

| Question           | Decision                                                                                                                                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What auto-merges   | npm and GitHub Actions updates whose (highest) change is patch or minor. Majors and Terraform providers (Andy plans and applies those locally) stay manual. Logic in `scripts/dependabot-merge.mjs`, tested.                                                                                               |
| How                | `dependabot-auto-merge.yml` → composite action `platform/actions/dependabot-auto-merge` → `gh pr merge --auto --squash`. GitHub merges only after every required check passes (CI, CodeQL, dependency review, secret scan, Terraform checks; the review agents report "not reviewed" on Dependabot PRs).   |
| Who can trigger it | Only Dependabot's own events on a same-repo Dependabot PR (`user.login` and `actor` both `dependabot[bot]`). A human push to a Dependabot branch skips the job.                                                                                                                                            |
| Write token safety | The job checks out the **base** commit, so the action and script that hold the write token come from `main`, never from the PR (Dependabot PRs bump pins inside `platform/actions/`). Never `pull_request_target`.                                                                                         |
| Deploys            | Auto-merged updates reach the control plane with the next merge that triggers `deploy.yml` (Andy's), so prod still changes only on Andy's merges. Push-triggered scans on `main` also skip these commits; the PR ran them.                                                                                 |
| Repo setting       | `allow_auto_merge: true` in `platform/baseline/github/repo.json`. Applied by Andy with `baseline.mjs`.                                                                                                                                                                                                     |
| Notifications      | `.github/CODEOWNERS` with `* @albernhagen` (seed file in the baseline): Andy is requested on every PR he didn't author, Dependabot's included. The ruleset keeps `require_code_owner_review: false` (Andy can't approve his own PRs). Paths listed after `*` are the review gate's protected paths (§4.5). |

### Consequences

- Good: routine updates land without Andy; majors still get a look; Andy is notified of every Dependabot PR; managed repos get both through the baseline.
- Bad: a compromised patch/minor release that passes the 7-day cooldown and every scan merges unreviewed (threat model R17); it reaches prod only with Andy's next deploying merge. The first auto-merge has to confirm the no-deploy behaviour.
