# Runbook: onboard a managed project (Andy)

Every hand step to give a repo its own project in the control plane, so agent tasks (refine, plan, build) run there. A **managed repo** is a repo registered on a project other than `AI`; its `agent-run.yml` calls this repo's executor (ADR-0096: Managed repos call one executor). This page orders the steps and links the runbooks that hold the detail. About 30 minutes.

**Follow it in the app:** the project's setup path, `/p/<project>/setup`, shows every step below in this order as a card, with its command (repo filled in, a copy button), the GitHub page where it is done, and a status: read live by the App where it can, else **Mark done** by you (shown as marked by hand). Steps 1 and 2 also show on Add project, because the project needs the repo and the App first. This page stays the source the app matches: a domain test (`onboarding.test.ts`) fails if a command there isn't written here.

## Limits: check these first

The setup path checks each one before the first step (Add project checks the first two) and names any that fails.

| The repo must…                               | Why                                                                                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use pnpm, with `pnpm-lock.yaml` and `.nvmrc` | The executor installs pnpm and Node only when those files exist. Other toolchains get no install step: a build agent can edit code but can't run the project's checks |
| Be public (on GitHub Free)                   | Private repos get no rulesets, environments or code scanning, so no `protect-main` and no `main`-only `agent` environment                                             |
| Have default branch `main`                   | Dispatch refuses any other default branch                                                                                                                             |
| Be the project's only repo                   | Agent tasks run in the project's first repo only                                                                                                                      |

## Steps

`<owner>/<name>` is the repo; the app fills it in. "Status" says how the setup path knows the step is done.

| #   | Do                                                                                                                                                                                                                                                                                                            | Status                                                                                              | Detail                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Create or pick the repo. A new, empty repo: run `onboard` now (pushes the baseline and starter to `main`, applies the settings); step 4 is then done.                                                                                                                                                         | Live: the App sees the repo                                                                         | [`onboard-a-repo.md`](onboard-a-repo.md) §3 (new) or §4 (existing) |
| 2   | Install the GitHub App on the repo: Settings → GitHub → **Install on repos** → add it.                                                                                                                                                                                                                        | Live: the App sees the repo                                                                         | [`github-app.md`](github-app.md) §3                                |
| 3   | Create the project with that repo: Add project → name, key, repo. This opens the repo to dispatch and the push grant. The App opens a baseline PR, or a Needs-you ticket if there is nothing to add (move it to Done) or the repo is empty (run `onboard`).                                                   | Live: the project exists                                                                            | [`github-app.md`](github-app.md) §4                                |
| 4   | Baseline PR: run its `finish …` command (adds `agent-run.yml` and the other workflows the App can't write; the PR's description has the line with the sha), review, merge. Then `apply --dry-run`, `apply`, `check` (exit 0).                                                                                 | Live: every baseline file on `main`; ruleset `protect-main` active                                  | [`onboard-a-repo.md`](onboard-a-repo.md) §2                        |
| 4a  | Only when the project's deploy kind is `cloud-run` and it hasn't deployed yet: apply the deploy environments the baseline PR seeded in `infra/` (one environment or two, each with a budget), then set the repo variables from its output. Run in a clone of the repo. A `none` project shows this step done. | Live once a deployment succeeded; before that, Mark done (the App can't read GCP or repo variables) | [`project-env.md`](project-env.md)                                 |
| 5   | **Allow reusable workflows.** Repo → Settings → Actions → General: **Allow all actions and reusable workflows**, and Workflow permissions **Read repository contents**. `apply` sets both; check them here, because `agent-run.yml` can't call the executor without the first.                                | Mark done (the App can't read Actions settings)                                                     | No other runbook has this step                                     |
| 6   | Reviewer token as a repo secret. The review agents run on PR branches and read it.                                                                                                                                                                                                                            | Mark done (the App can't read secrets)                                                              | [`onboard-a-repo.md`](onboard-a-repo.md) §3 step 1                 |
| 7   | Agent tasks' token: environment `agent`, `main` only, with its own `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`, a new token).                                                                                                                                                                             | Live: environment and branch rule; then Mark done for the token                                     | [`agent-environment.md`](agent-environment.md) steps 1 to 3        |
| 8   | Run one refine on a ticket in the new project (the setup path offers one on an Up-next ticket). In the repo's Actions run, the `agent` job shows environment `agent` and "Check the model credential" passes.                                                                                                 | Live: a refine task succeeded; by hand if the app can't see back far enough                         | [`agent-environment.md`](agent-environment.md) step 4              |
| 9   | Turn **Builds** on in the project's settings (the app only, no MCP tool). The setup checklist shows Repo connected, Baseline merged and Threat model started done; the other two stay "not yet" until M6.                                                                                                     | Live: builds on                                                                                     | —                                                                  |

The setup path puts the brief, plan and approve steps between 7 and 8: the brief is a PR on the repo (its checks need steps 4 to 6), and the proving refine needs a ticket from the approved plan.

### Commands

```sh
# 1. Create the repo; a new, empty one: onboard it
gh repo create <owner>/<name> --public
node platform/baseline/baseline.mjs onboard <owner>/<name> --ref v1.0.0

# 4. Baseline PR, then the repo settings (from an andy-intelligence checkout)
node platform/baseline/baseline.mjs finish <owner>/<name> --ref <sha> --branch baseline/<sha7>
node platform/baseline/baseline.mjs apply <owner>/<name> --dry-run
node platform/baseline/baseline.mjs apply <owner>/<name>
node platform/baseline/baseline.mjs check <owner>/<name>

# 4a. cloud-run only, in a clone of the repo, after infra/terraform.tfvars has real values
gcloud storage buckets create gs://<prod project>-tfstate --project <prod project> --location us-central1 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://<prod project>-tfstate --versioning --lifecycle-file=<(echo '{"rule":[{"action":{"type":"Delete"},"condition":{"isLive":false,"numNewerVersions":10}}]}')
terraform -chdir=infra init -backend-config="bucket=<prod project>-tfstate"
terraform -chdir=infra plan -out=deploy.tfplan
terraform -chdir=infra apply deploy.tfplan
terraform -chdir=infra output -json repo_variables > repo-vars.json
jq -r 'keys[]' repo-vars.json | while read -r name; do gh variable set "$name" --repo <owner>/<name> --body "$(jq -r --arg n "$name" '.[$n]' repo-vars.json)"; done && rm repo-vars.json

# 6 and 7. A token each; never paste one into chat or a file
claude setup-token
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo <owner>/<name>
```

## If it fails

| Symptom                                                     | Fix                                                                                                                                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run fails: "the App isn't installed on …"                   | Step 2                                                                                                                                                                                                   |
| Run fails: "agent tasks need the default branch to be main" | Rename the default branch to `main`                                                                                                                                                                      |
| `agent-run.yml` fails before the executor starts            | Step 5; an account-wide Actions policy can override the repo's setting. If the error names SHA pinning (`apply` requires it; the caller uses `@main`, untested): stop and decide, don't just turn it off |
| "Check the model credential" fails                          | Step 7 (or step 6's repo secret on a private repo)                                                                                                                                                       |
| Build PR's checks fail on install                           | The repo isn't pnpm (Limits)                                                                                                                                                                             |
