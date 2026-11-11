---
status: accepted
date: 2026-11-10
amends: 0078 (the low-risk class a coordinator session may merge)
---

# 0084 — Lockfile-only fixes for Dependabot alerts join the low-risk class

Decided by Andy, 2026-11-10. After merging PR #115 (AI-68: Dependabot alerts) he said: "This seemed like a small one that I would have expected to auto merge." Asked whether the coordinator may merge dependency-alert fixes itself, he answered yes. Andy's merge of this ADR's PR is the authorisation a later reader can verify.

## Context and Problem Statement

ADR-0078 lets a coordinator session merge only PRs confined to the UI, domain logic, store read paths, read-only MCP tools and five docs paths. Dependency files are outside it, because they are a supply-chain surface (threat model R7, R17). So a two-file PR that only clears open Dependabot alerts waits on Andy, although Dependabot's own patch and minor PRs already merge without him (ADR-0042). Dependabot does not open PRs for transitive ranges, so those alerts need a hand-written fix every time.

## Decision Outcome

A PR is also in ADR-0078's low-risk class when **all** of these hold, on top of ADR-0078's Checks, Reviews, Synced and Size conditions:

| Condition | Rule                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files     | Only `pnpm-lock.yaml` and the root `package.json`, and in `package.json` only `pnpm.overrides` entries and their comment key. No `scripts`, no new dependency, no workspace `package.json`.  |
| Purpose   | Each changed version closes an open Dependabot alert named in the PR description; nothing else moves.                                                                                        |
| Versions  | No package crosses a major version, directly or by override. Every new version is at least 7 days old (ADR-0042's cooldown).                                                                 |
| Evidence  | `dependency-review` passes, the full suites and the Firestore suite pass on the head, and both review agents posted a verdict on the head (a lockfile change is not docs-only, so they run). |
| After     | The coordinator checks that the named alerts closed on `main` and records the merge in the digest like any other.                                                                            |

Everything else that touches dependencies stays with Andy: a major-version jump (PR #115 itself, which moved `glob` and `minimatch` across majors, would still be his), a new dependency, any `scripts` change, a workspace manifest, a lockfile change that fixes no alert, and anything the coordinator is unsure of.

The product's gate keeps treating dependency files as a protected path (AI-34); mirroring this rule there is a separate ticket, decided when `autoMerge` is turned on for project `AI`.

## Consequences

- Good: routine alert fixes stop waiting on Andy; the rule is narrow enough to check mechanically from the diff and the alert list.
- Bad: a hijacked patch or minor release that is over 7 days old and passes every scan reaches `main` without a human, the same residual as R17. The cooldown, the required scans, the no-major rule and the digest record bound it.
