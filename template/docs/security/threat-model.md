---
version: 1
last_reviewed: never
reviewed_by: —
---

# Threat model

Living doc. Update it in the same PR whenever you add or change a trust boundary, entry point, credential, or IAM grant. The per-PR security review reads it.

Severity: `critical` (exploitable now, big blast radius) · `high` (exploitable with modest effort, or big blast radius) · `medium` (needs an unlikely precondition) · `low` (defense in depth).

## Assets

| Asset              | Where                                    | Why it matters                           |
| ------------------ | ---------------------------------------- | ---------------------------------------- |
| Repo `main` branch | GitHub                                   | Code that ships                          |
| Review token       | Actions secret `CLAUDE_CODE_OAUTH_TOKEN` | Quota theft; tied to the owner's account |

## Trust boundaries and entry points

| Entry point                      | Who can reach it                  | Authn/authz                                              | Note                                             |
| -------------------------------- | --------------------------------- | -------------------------------------------------------- | ------------------------------------------------ |
| GitHub Actions on `pull_request` | Anyone who can push a branch here | Workflows run the PR's own caller files                  | Fork PRs get no secrets                          |
| Review agents                    | PR diff (untrusted)               | Read/Glob/Grep only; procedures from the pinned baseline | Prompt injection in the diff is itself a finding |

## Credentials and identities

| Credential                | Holder         | Scope               |
| ------------------------- | -------------- | ------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Actions secret | Model requests only |

## Mitigations in place

- Project baseline: `main` ruleset, required checks, secret scanning + push protection, Dependabot, read-only default workflow token, actions pinned to SHAs.

## Open risks

| ID  | Risk | Severity | Status | Owner | Mitigation / next step |
| --- | ---- | -------- | ------ | ----- | ---------------------- |
