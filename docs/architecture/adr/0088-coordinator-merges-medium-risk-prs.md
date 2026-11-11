---
status: accepted, amended by 0092
date: 2026-11-11
amends: 0078 (which PRs a coordinator session may merge); AGENTS.md rule 2
---

# 0088 — The coordinator merges low- and medium-risk PRs; only high-risk PRs wait for Andy

Decided by Andy, 2026-11-11: "You can merge low and medium risk PRs now (save just high ones for me). You can queue them up. I just need to be reported on what has been built/changed at a summary level which I have expected to be a part of the product we build anyway." Andy's merge of this ADR's PR is the authorisation a later reader can verify; the coordinator does not merge it.

## Context and Problem Statement

ADR-0078: Coordinator merges low-risk PRs left every medium-risk PR with Andy. In M2: Self-hosting that was most PRs: tickets build on each other, so each one waited on his merge and several parallel workers serialised on him. He has little time for the next days and wants the work to keep landing while he is away, with a summary to read afterwards.

## Decision Outcome

A coordinator session may merge a PR itself when it is **low risk** (ADR-0078, ADR-0084, unchanged) or **medium risk**. A PR is medium risk when all of ADR-0078's Checks, Reviews, Synced and Size rows hold (every check green on the head; both review agents posted a verdict on that head with no open blocker, should-fix, high or critical finding, a fix and not a reply clearing each; latest `main` merged in and rerun; size S or M; no `review-accepted` or `security-accepted` label) **and** nothing in its diff is high risk.

High risk, so **Andy merges**:

| Area             | What counts                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CI and infra     | `.github/`, `infra/`, anything needing `terraform apply`, deploy or release paths, `platform/actions/**`, `platform/baseline/**`.                                                                            |
| Access           | Sign-in, the allow-list, permissions (AI-19: One permission function), IAM; a new or changed credential or secret; an entry point that is unauthenticated or takes input from outside (webhooks, callbacks). |
| Data             | Firestore rules, a `SCHEMA_VERSION` bump, a migration.                                                                                                                                                       |
| Review and merge | The review agents' procedures, the gate and its protected paths (AI-34: M1.8b: Gate and auto-merge), the executor sandbox (`scripts/executor-*`, `platform/executor/**`).                                    |
| Rules for agents | `AGENTS.md`, `CLAUDE.md`, `docs/BUILD-PROMPT.md`, `.claude/**`, `context-budget.json`, `CODEOWNERS`, `platform/procedures/coordinate.md`, runbook `coordinating-sessions.md`, and any ADR about who merges.  |
| Dependencies     | A new dependency, a major version jump, install `scripts` (ADR-0084 covers lockfile-only alert fixes).                                                                                                       |
| Decisions        | A docs-only PR that adds or changes an ADR or `docs/security/**`. These files may change inside a ticket's own PR when they record what that PR does.                                                        |
| Size and doubt   | Size L; a docs-only PR the coordinator has not read in full; anything the coordinator or a reviewer is unsure of.                                                                                            |

The coordinator never merges a change to its own authority.

High-risk PRs queue for Andy: verified, listed in the digest in merge order, re-synced when he is ready to merge.

**Reporting.** Every merge is recorded in the milestone digest (PR, ticket, class, who merged, verdicts), and the digest opens with a plain summary of what was built or changed, written for someone who read none of the PRs. The product's daily digest (ADR-0081) takes this over as the control plane merges its own work.

## Consequences

- Good: tickets that build on each other land without waiting on Andy; he reviews the few PRs that touch access, infrastructure, data shape or the review system.
- Bad: a wrongly classified or subtly wrong feature PR reaches `main` and deploys without a human reading it. Bounds: the required checks and both review agents on every non-docs PR, the high-risk list, safe deploy and rollback (AI-62), the digest. The threat model carries it as R23.
- The gate's `would_auto_merge` (AI-34) still uses its own rules; aligning them is part of the `autoMerge` trial, after which this manual rule retires for project `AI`.
