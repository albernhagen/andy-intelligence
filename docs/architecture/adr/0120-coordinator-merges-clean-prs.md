---
title: Coordinator merges every clean PR; Andy keeps four kinds
status: accepted; superseded in part by 0124 (who merges: MCP `merge_pr`, AI-220)
date: 2026-11-20
amends: 0088, 0092 (who merges); AGENTS.md rule 2
---

# 0120 — The coordinator merges every PR that passes its checks and reviews; Andy keeps four kinds

Andy, 2026-11-20: "in this time of rapid development, I don't really need to merge individual PRs. I'm mostly rubber stamping them. I think I'd rather you just keep merging things but build something in the UI to give me project statuses/release notes or something akin to that so I know what's been built feature wise and how it technically works." Andy's merge of this ADR's PR is the authorisation; the coordinator does not merge it.

## Context and Problem Statement

ADR-0088 let a coordinator session merge low- and medium-risk PRs and ADR-0092 listed what stayed high risk for Andy. Between 2026-11-12 and 2026-11-20 about thirty PRs were built in parallel; more than half were high risk by ADR-0092's list (workflows, the executor, agent rules, security docs, dependencies), so they queued for Andy. He was away for days, each merge he made conflicted the others, and he read few of them closely. The queue slowed the work without adding review.

## Decision Outcome

A coordinator session merges any PR for which **all** of these hold on the PR's current head:

| Condition | Check                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Checks    | Every check has passed, required or not.                                                                                                                           |
| Reviews   | Both review agents posted a verdict on that head with no open blocker, should-fix, high or critical finding. A docs-only PR: the coordinator reads the whole diff. |
| Synced    | The head contains the latest `main`, and checks and reviews ran after that.                                                                                        |
| Labels    | No `review-accepted` or `security-accepted` label.                                                                                                                 |

One PR at a time, squash, then `main`'s checks and the deploy must pass before the next.

**Andy keeps four kinds**, whatever else a PR contains:

| Kind                  | What counts                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who merges            | Any change to this ADR's rule, to `platform/procedures/coordinate.md`, to runbook `coordinating-sessions.md`, to `AGENTS.md` rule 2, or a new ADR about who merges.                                                                                                                                                                                                                                                           |
| What judges a PR      | The checks and reviews themselves: `.github/**`, `platform/actions/**`, `platform/baseline/**`, `CODEOWNERS`, `scripts/review-*.mjs`, the review procedures and their schemas in `platform/procedures/`, and the eval cases and runner (`platform/evals/**`, `scripts/evals/**`). A PR runs its own workflow files and actions (threat model R5), so its green checks and clean reviews prove nothing about a change to them. |
| Needs Andy's hands    | A PR that only takes effect when Andy acts: Terraform that needs `terraform apply`, a new secret or credential, an external account, a GitHub App permission. He merges when he acts.                                                                                                                                                                                                                                         |
| Open finding or doubt | A PR with a finding still open, an accepted label, or one the coordinator or a reviewer is unsure of.                                                                                                                                                                                                                                                                                                                         |

ADR-0092's table no longer decides who merges; it stays as the list of paths where a reviewer and the coordinator look hardest. Size no longer decides either.

**How Andy follows the work:** every PR carries a capped release note (what changed, how it works, what needs him), stored on merge and shown per project with milestone status (AI-159: What's new). Until that page is live, the coordinator's digest carries the same per-merge lines.

### Consequences

- Good: work lands as fast as it passes; Andy reads short notes instead of diffs; the queue that conflicted on every merge shrinks to the four kinds.
- Bad: no human reads a diff to the executor sandbox, the gate, permissions, schemas, dependencies or the agent rules before it reaches `main`. The two review agents, the checks, the one-at-a-time rule and `main`'s own checks are the controls, and the coordinator reads untrusted text (threat model R23, high, open).
- The conditions are applied by hand. Not done here, and worth a ticket: make the fourth kind mechanical (CODEOWNERS-required approval on those paths in the `protect-main` ruleset) and require up-to-date branches.
- Revisit when project `AI` turns `autoMerge` on (the gate then merges product PRs), or at the first bad merge.
