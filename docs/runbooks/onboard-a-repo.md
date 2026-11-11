# Onboard a repo to the project baseline — runbook (Andy)

The **project baseline** is the set of guardrails every repo Andy manages gets: CI and security checks, review agents, local hooks, repo files, and GitHub settings (ADR-0031: Project baseline, ADR-0038: Baseline carried by composite actions; inventory in ARCHITECTURE §8.1). One script applies and checks it: `platform/baseline/baseline.mjs`. Run it from a clone of andy-intelligence on your machine; it uses your `gh` login (admin on your repos). Never run it in CI.

| Term                  | Meaning                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Ref                   | A tag (`v1.0.0`), branch (`origin/main`) or SHA of andy-intelligence. It must be pushed: managed repos pin its commit SHA. |
| Managed file          | Kept identical to the baseline (workflows, hooks, Dependabot, PR template, Prettier config). Edits show up as drift.       |
| Seed file             | Written once if missing (`AGENTS.md`, `.github/CODEOWNERS`, `docs/security/threat-model.md`); the repo owns it after that. |
| Starter               | A minimal TypeScript project (`package.json`, `tsconfig.json`, `src/`), written only into a repo with no `package.json`.   |
| `.andy/baseline.json` | Which andy-intelligence commit the repo's files came from.                                                                 |
| Drift                 | A live setting or managed file that differs from the baseline.                                                             |

| Command                                                                    | Does                                                                                                                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node platform/baseline/baseline.mjs onboard <owner/repo> --ref <ref>`     | `files`, then `apply`                                                                                                                                |
| `… files <owner/repo> --ref <ref>`                                         | Clones the repo, writes the files, runs `pnpm install` (lockfile + hooks). Empty repo: pushes to `main`. Otherwise: opens a PR from `baseline/<sha>` |
| `… apply <owner/repo> [--dry-run]`                                         | Sets repo, security, Actions, labels and `protect-main` ruleset (without `github/source-only.json` checks); `--dry-run` only prints the diff         |
| `… check <owner/repo> [--only repo,security,actions,labels,ruleset,files]` | Prints drift; exit 1 on drift, 2 on error                                                                                                            |

Before you start: `gh auth status` shows you logged in; Node 22+; `pnpm` (or `npx` falls back to pnpm 10.28.0); `git fetch` in andy-intelligence so the ref resolves.

## 1. Bring andy-intelligence itself to the baseline (once, after the M1.16 PR merges)

```sh
git switch main && git pull
node platform/baseline/baseline.mjs apply albernhagen/andy-intelligence --dry-run
```

Expected drift on 2026-11-02 (everything else `ok`):

| Setting                                              | Now             | Baseline                                            |
| ---------------------------------------------------- | --------------- | --------------------------------------------------- |
| `security.private_vulnerability_reporting`           | `false`         | `true`                                              |
| `actions.permissions.sha_pinning_required`           | `false`         | `true` (every workflow here pins full SHAs)         |
| `actions.workflow.default_workflow_permissions`      | `write`         | `read` (every workflow sets its own `permissions:`) |
| `labels[0]` (`security-accepted`) color, description | `7E8B33`, empty | `B60205`, the description in `github/labels.json`   |

```sh
node platform/baseline/baseline.mjs apply albernhagen/andy-intelligence
node platform/baseline/baseline.mjs check albernhagen/andy-intelligence    # all ok; files: skipped (source repo)
```

Then tag the baseline version that repos will pin:

```sh
git tag v1.0.0 origin/main && git push origin v1.0.0
```

## 2. Onboard a new repo

```sh
gh repo create albernhagen/<name> --public
node platform/baseline/baseline.mjs onboard albernhagen/<name> --ref v1.0.0
```

Then:

1. Reviewer token (the review agents report "not reviewed" until it is set; nothing else needs it). Never paste it into chat or a file:
   ```sh
   claude setup-token
   gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo albernhagen/<name>
   ```
2. Open a first PR so every check runs once.
3. `node platform/baseline/baseline.mjs check albernhagen/<name>` → exit 0.
4. To manage it from the control plane: Settings → GitHub → **Install on repos** → add it, then create its project with the repo in the UI (`docs/runbooks/github-app.md` §4).

Use a **public** repo: on a free GitHub plan, rulesets and code scanning only work on public repos.

## 3. Onboard an existing repo

```sh
node platform/baseline/baseline.mjs files albernhagen/<name> --ref v1.0.0   # opens a PR
```

Review and merge the PR (an existing repo needs `pnpm lint/typecheck/test/build` scripts, `.nvmrc`, and `lefthook` as a dev dependency with `"prepare": "lefthook install"`). Then `apply` (a dry run first) and `check`. Apply the ruleset only after the PR merges: before that, its required checks don't exist on `main`.

## 4. Update a repo to a newer baseline

Dependabot bumps the action pins weekly. `check` then reports `pins …, but .andy/baseline.json says …`: run `files` at the new tag to update every managed file and the record in one PR.

```sh
node platform/baseline/baseline.mjs files albernhagen/<name> --ref v1.1.0
```

## 5. M1.16: Project baseline v1 demo ("Done when")

Run it before merging, from the PR branch. The scratch repo gets no Claude token, so both review agents report a neutral "not reviewed" under the same check names and use no quota.

```sh
git fetch origin m1.16/project-baseline
gh repo create albernhagen/baseline-scratch --public --description "M1.16 demo; delete after"
node platform/baseline/baseline.mjs onboard albernhagen/baseline-scratch --ref origin/m1.16/project-baseline
```

Expect `pushed Project baseline … to main (empty repo)` and every section `ok`. Then a test PR:

```sh
gh repo clone albernhagen/baseline-scratch /tmp/baseline-scratch && cd /tmp/baseline-scratch
git switch -c test/demo && sed -i '' 's/Hello/Hi/' src/index.ts src/index.test.ts
git commit -am "test: demo change" && git push -u origin HEAD
gh pr create --fill && gh pr checks --watch
```

1. **Same checks as andy-intelligence:** `check`, `actionlint`, `terraform`, `trufflehog`, `codeql (javascript-typescript)`, `codeql (actions)`, `dependency-review`, `terraform-misconfig`, `security-review`, `adversarial-review` all pass (`terraform` ones with a "no infra/" notice; reviews "not reviewed").
2. **No drift:** `node platform/baseline/baseline.mjs check albernhagen/baseline-scratch` → every line `ok`, exit 0.
3. **Hand change shows as drift:** Settings → Actions → General → Workflow permissions → **Read and write** → Save. `check` again → `actions: drift`, `workflow.default_workflow_permissions: want "read", have "write"`, exit 1. `apply` puts it back.
4. Clean up: `gh auth refresh -s delete_repo` (once), then `gh repo delete albernhagen/baseline-scratch --yes`.

## 6. Dependabot auto-merge and CODEOWNERS (ADR-0042)

Once, after the PR that adds them merges:

```sh
git switch main && git pull
node platform/baseline/baseline.mjs apply albernhagen/andy-intelligence --dry-run   # expect: repo.allow_auto_merge false → true
node platform/baseline/baseline.mjs apply albernhagen/andy-intelligence
```

Check on the next Dependabot PR:

| Dependabot PR                                             | Expected                                                                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm patch, or minor of a 1.0+ package                     | `dependabot-auto-merge` job enables auto-merge; GitHub squash-merges after the required checks pass; `Deploy control plane` starts no deploy job for that merge (bot actor) |
| Major, 0.x minor, GitHub Actions, or a Terraform provider | Job logs "… merged by hand"; the PR waits for you                                                                                                                           |
| Any                                                       | You get a review request (CODEOWNERS). No request? GitHub → Settings → Notifications: "Participating, @mentions and custom" on                                              |

Your next merge deploys the update. If `Deploy control plane` did deploy the bot's merge, note it in the build log: the `deploy.yml` guard failed.

Managed repos get both with the next baseline tag (§4: Update a repo to a newer baseline).

## Troubleshooting

| Symptom                                                                          | Fix                                                                                                                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `<sha> (<ref>) isn't on GitHub`                                                  | Push the ref first; managed repos can only pin commits that exist on GitHub.                                                              |
| `security: unreadable` / `HTTP 403`                                              | Your `gh` login isn't an admin of that repo.                                                                                              |
| `apply` fails on `private-vulnerability-reporting` or `automated-security-fixes` | Run it again: GitHub enables these after vulnerability alerts, which `apply` turns on first.                                              |
| A check never reports on the new repo's PR                                       | Its job name doesn't match the ruleset; `pnpm test` in andy-intelligence checks this, so the repo's caller file was edited (see `check`). |
| Scratch PR `check` fails on `pnpm install --frozen-lockfile`                     | `pnpm-lock.yaml` wasn't committed: `files` runs `pnpm install` before committing; re-run it.                                              |
