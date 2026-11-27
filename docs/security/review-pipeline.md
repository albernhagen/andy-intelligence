# Threat model: Review pipeline

How PR review findings reach the control plane (ADR-0097: review findings become config proposals). Risks: [R5](risks/R5.md), [R-AI-394](risks/R-AI-394.md), [R-AI-406](risks/R-AI-406.md). PRs that change this area update this file.

## Trust boundaries and entry points

| Entry point                             | Who can reach it                                                                                     | Authn/authz                                                                                                                                                                                                                                                                                      | Notes                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review findings `POST /review/findings` | Internet; meant for the `*-review-record` jobs in `security-review.yml` and `adversarial-review.yml` | GitHub Actions OIDC token: signature (GitHub JWKS), issuer, audience = service URL, expiry (as `POST /github/token`). `workflow_ref` must be `<repository>/.github/workflows/(security\|adversarial)-review.yml@refs/pull/<n>/merge`, and `repository` must be a project's repo; otherwise `403` | Body ≤ 64 KB, ≤ 50 findings, title and file ≤ 300 chars each; ≤ 60 verdicts/minute per instance, counted after verification; ≤ 100 stored verdicts per project (oldest dropped). R5 |

- **Identity only from the token.** The repo, PR number and reviewer (security or adversarial) come only from `repository` and `workflow_ref`. The body carries just the head SHA (40 hex) and the findings; a strict schema rejects any other field. A finding's severity must be one that reviewer uses.
- **Replay and overwrite.** A verdict replaces the same reviewer's earlier verdict on the same PR, so a repeat post changes nothing new.
- **The job.** It checks out the base SHA, so the poster script comes from the base branch, holds only `contents: read` and `id-token: write`, and is `continue-on-error`: a failed post never fails the review.
- **Forged findings (R5).** A PR can edit its own review workflow and post made-up findings for itself. They are untrusted data: they only feed the config proposals sweep, whose titles are sanitized and shown as plain text ([`ui-and-mcp.md`](ui-and-mcp.md)), and nothing changes until Andy accepts a proposal.
- **No new credential.** It reuses the Actions OIDC verifier; no secret, IAM grant or GitHub permission is added.

## Release-note check: the before-and-after table (AI-353)

- **Untrusted input.** The PR description and its file names are data. `parseTable` (`scripts/screenshot-table.mjs`) accepts only rows of the exact shape the script writes: a safe `__screenshots__/*.png` path and `raw.githubusercontent.com` URLs of this repo pinned to 40-hex SHAs. Nothing reaches a shell; the job summary is rebuilt from the parsed rows, never copied from the description. A changed stored image whose file name isn't safe fails the check and is never printed (no workflow-command injection); the repo name and PR number from the event file are checked before they form an API URL.
- **No new permission.** The job keeps `contents: read`; it lists the PR's files with the job token, and on a refusal retries without it (public repo). Private repos skip the rule.
- **Residual.** As before, the check runs the PR's own copy of its scripts, so a PR could weaken it. ADR-0120 keeps `platform/actions/**` for Andy but not `scripts/release-note-check.mjs` or `scripts/screenshot-table.mjs`; the review agents still read such a change.

## Which PRs the review agents skip (AI-394)

The security and adversarial review agents skip, and their checks pass with the reason, for: drafts, forks, runs Dependabot starts (no secrets), docs-only changes (ADR-0030), and Dependabot minor or patch bumps. Rule: `scripts/review-scope.mjs`, called by `platform/actions/agent-review-prepare`.

- **What counts as a bump.** The PR author (`pull_request.user.login`, set by GitHub, not the PR) is `dependabot[bot]`, and the merged change, base to head, is only `package.json` files and pnpm lockfiles (an npm or yarn lockfile always gets reviewed), none under `.github/`, `infra/`, `platform/` or `template/`. Each changed `package.json` keeps every field but the dependency lists byte-for-byte (so no `scripts`, overrides or `packageManager` change), adds or removes no dependency, and moves each version as a plain version or `^`/`~` range, operator unchanged, within its major (`0.x`: within its minor). Each changed `pnpm-lock.yaml` adds no package and resolves every new version within a major already locked for that package, so a transitive major or a new transitive package runs the agents. Anything else, or any failure to read the change, runs the agents.
- **Later pushes.** The rule reads the PR's whole change on every run, so a person or agent pushing code, a workflow or a major bump to a Dependabot PR brings the agents back.
- **Still run on every bump:** CI (`check`, including the lockfile-sources check: npm registry and integrity only), dependency review, CodeQL, the secret scan.
- **No new permission or credential.** The step reads git and the event payload only.
- **Residual (R-AI-394).** No agent reads a skipped bump: a minor or patch release that is itself malicious is caught only by the 7-day cooldown, dependency review and CodeQL.

## Which PRs skip the screenshot check (AI-406)

`ui-screenshots` (required) passes without running, naming why, for a docs-only change or one where no changed file can affect the web app: `canAffectWebApp` in `scripts/review-scope.mjs`, called by `platform/actions/ui-screenshots`. Only paths on an explicit can't-affect list skip; unknown paths, unreadable diffs, renames, deletions, a change to the gate itself and pushes to `main` run. No new permission. Residual: [R-AI-406](risks/R-AI-406.md).
