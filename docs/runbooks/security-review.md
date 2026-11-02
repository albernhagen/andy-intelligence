# Security review — runbook (Andy)

Manual steps for per-PR scans, the security-review agent and the system security review (ADR-0025: Agentic security review, ADR-0030: Security review automation choices). Do step 3 **before** merging PR "M1.10: Security review automation" (`dependency-review` fails until the dependency graph is on); steps 1, 2, 4–6 after it merges.

| Term                      | Meaning                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Repository Actions secret: a one-year Claude subscription token from `claude setup-token`. It can only make model requests.         |
| `security-accepted`       | PR label: Andy accepts the high/critical findings. Write why in the PR. Removed automatically on the next push.                     |
| Neutral                   | The agent couldn't run (no token, draft, Dependabot, quota, outage): the check passes with a "not reviewed" comment and you decide. |

## 1. Reviewer token secret

Never paste the token into chat, a file, or a commit.

```sh
claude setup-token                                                     # browser approval; prints the token once
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo albernhagen/andy-intelligence   # paste at the hidden prompt
```

Clear your terminal scrollback afterwards. Rotate yearly (same commands; set a calendar reminder for 2027-10).

## 2. Label

```sh
gh label create security-accepted --repo albernhagen/andy-intelligence \
  --color B60205 --description "Andy accepts the security-review high/critical findings (reason in the PR)"
```

## 3. Repo settings

| Where (Settings →)                       | Set                                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Advanced Security                        | Dependency graph **on**; Dependabot alerts **on**; Dependabot security updates **on**; secret scanning + push protection **on** (already, ADR-0015) |
| Advanced Security → Code scanning        | Leave **default setup off** (`security-scans.yml` is the advanced setup; both at once conflict)                                                     |
| Actions → General → Workflow permissions | Tick **Allow GitHub Actions to create and approve pull requests** (the system review opens PRs). Default token stays read-only.                     |

## 4. Required checks (ruleset on `main`)

Settings → Rules → Rulesets → New branch ruleset, target `main`, enforcement Active:

- **Require a pull request before merging** (0 approvals is fine; you merge).
- **Require status checks to pass**, add: `check`, `actionlint`, `terraform`, `trufflehog`, `security-review`, `dependency-review`, `terraform-misconfig`, `codeql (javascript-typescript)`, `codeql (actions)`.
- **Require code scanning results**: tool `CodeQL`, alerts **Errors**, security alerts **High or higher**.
- **Block force pushes.**

Checks appear in the picker only after they ran once (on the M1.10 PR).

## 5. Check the per-PR review works (M1.10 "Done when")

```sh
git switch -c test/security-review-demo origin/main
# Planted issue: give the CI plan identity Owner.
perl -pi -e 's|^(\s+)"roles/viewer",|$1"roles/viewer",\n$1"roles/owner",|' infra/bootstrap/main.tf
git commit -am "test: planted over-broad IAM role (do not merge)" && git push -u origin HEAD
gh pr create --title "test: security review demo (do not merge)" --body "Planted roles/owner on tf-plan."
```

1. Wait for **Security review**: a PR comment lists a `high`/`critical` finding on `infra/bootstrap/main.tf`; the `security-review` check fails. (`terraform-misconfig` may fail too; that's fine.)
2. Add the `security-accepted` label: the check re-runs and passes (agent not re-run; comment unchanged).
3. Push any commit: the label is removed and the review runs again (fails again).
4. Close the PR and delete the branch.

## 6. System security review

Runs Mondays 14:00 UTC if anything merged in the last 7 days. **Run it by hand at the end of every milestone** and before closing one:

```sh
gh workflow run system-security-review.yml --repo albernhagen/andy-intelligence
gh run watch --repo albernhagen/andy-intelligence
```

- If the threat model changed, a PR "Security: system review YYYY-MM-DD" opens. It is opened by `github-actions[bot]`, so GitHub holds its checks: **approve the workflow runs** (banner on the PR), then review and merge. This goes away when M1.5: GitHub App + project registration opens these PRs with the App's token.
- No changes → a notice, no PR.
- Milestone gate: no `open` high/critical risk in `docs/security/threat-model.md`, unless you set it to `accepted` with a reason.

The run also calls `terraform-plan.yml` for a drift summary (addresses only, no values) with the read-only `tf-plan` identity.

## Troubleshooting

| Symptom                                                               | Fix                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comment says "not reviewed: … CLAUDE_CODE_OAUTH_TOKEN is not set"     | Step 1                                                                                                                                                                    |
| "the agent run failed"                                                | Open the run log: quota exhausted or token expired → wait or redo step 1. The check is neutral meanwhile.                                                                 |
| Docs-only PR: "not reviewed"                                          | Expected: the agent is skipped to save quota (ADR-0030). Agent rule files (`AGENTS.md`, `CLAUDE.md`, `docs/BUILD-PROMPT.md`, `platform/procedures/`) are always reviewed. |
| Reviewer uses too much quota                                          | Each comment shows turns, tokens and an API-equivalent estimate. Lower `--max-turns` in `security-review.yml`, or move the reviewer to an API key with a spend cap.       |
| Dependabot PR: "not reviewed"                                         | Expected: Dependabot runs get no repo secrets. Dependency review and CodeQL still gate it.                                                                                |
| Dependabot Terraform PR: `Terraform plan` fails on missing `TF_VAR_*` | Expected (no Dependabot secrets). Plan locally before merging.                                                                                                            |
| System review fails "changed files other than the threat model"       | The agent overstepped; nothing was pushed. Re-run; if it repeats, tighten `platform/procedures/threat-model.md`.                                                          |
| System review can't open the PR                                       | Step 3, Actions setting                                                                                                                                                   |
