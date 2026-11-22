---
title: The merge verdict, and an unset merge mode merges nothing
status: proposed (AI-215; Andy decides at review)
date: 2026-11-21
amends: 0124 (the mapping, review findings, epic mode), 0050 (`autoMerge` and `set_auto_merge` retired)
---

# 0134 — The gate merges by one merge verdict; a project with no saved mode merges nothing

AI-215: Merge modes: one merge verdict, and the gate merges by the project's mode, under AI-212: Merge modes. ADR-0124 decided the modes; building the gate on them raised three points it doesn't settle.

## Context and Problem Statement

| Point         | What ADR-0124 says                                                                                          | Why it needs a decision                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unset mode    | Read projects stored before `mergeMode` through a mapping from `autoMerge`; project AI maps to `all-clean`. | Merging the gate change would itself turn on merging without Andy for project AI. The coordinator asked that the switch be an explicit step Andy takes after merging.                                                   |
| Open findings | "Clean" includes no open blocker, should-fix, high or critical finding.                                     | The review checks fail only on blocker (adversarial) and critical or high (security). A should-fix passes the check, and no store of findings per PR head exists yet (`ReviewFindingSource` has no production adapter). |
| Epic mode     | Stories merge into `epic/<KEY>`; Andy merges one PR per epic.                                               | That grouping is AI-216.                                                                                                                                                                                                |

## Decision Outcome

| Topic         | Decision                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The verdict   | `mergeVerdict(facts, mode)` in `packages/domain/src/merge-verdict.ts`, pure, from host facts only: the gate's decision on the head, changed paths, labels, `headContains` (head has the default branch's tip), findings recorded for this repo, PR and head. Never PR text. Returns `merge` or `wait` with every reason. |
| Path lists    | One file, `packages/domain/src/merge-paths.ts`: `KEPT_PATHS` (wait in every mode) and `HIGH_RISK_PATHS` plus `DOCS_ONLY_HIGH_RISK_PATHS` (wait in `low-risk`). The coordinator procedure and CODEOWNERS (AI-217) cite it. The gate's own vetoes (`PROTECTED_GLOBS`) stay.                                                |
| Unset mode    | Merges nothing: the mode in force is the saved one, else `manual`. ADR-0124's mapping becomes `suggestedMergeMode`, shown on the settings page and over MCP while unset. Turning merging on is Andy saving a mode on the settings page; over MCP only `manual` can be saved then, since MCP may only tighten.            |
| Unknown facts | Wait: labels not read, up-to-date not checkable, a findings store's read failed. Open findings come from the review checks, which fail on any open blocker, should-fix, high or critical finding (answer below); a findings store, when wired, is read as well.                                                          |
| Epic mode     | Waits (`mode_epic`) until AI-216 builds the grouping. Night merges into `epic/<KEY>` (ADR-0107) are unchanged in every mode.                                                                                                                                                                                             |
| Record        | The Run stores `mergeMode`, `mergeVerdict` and `verdictReasons` for each head into the default branch; a merge comments the mode on the ticket.                                                                                                                                                                          |
| Retired       | MCP `set_auto_merge` and the settings page's Auto-merge control; `autoMerge` leaves `get_project_settings`. Stored values stay, for the suggestion.                                                                                                                                                                      |

### Consequences

- Good: merging the code changes nothing until Andy saves a mode; each unknown is a named reason on the Run; the lists live in one file.
- Bad: PRs with an open should-fix go red until fixed or labelled `review-accepted`; a managed repo on a baseline from before this change passes should-fix, so its gate would treat should-fix as clean until it updates.
- Accepted: a saved `all-clean` lets the gate merge PRs touching high-risk but not kept paths, as ADR-0124 intends.

## Question for Andy: answered

**How should the gate learn that a PR's head has no open should-fix finding?**

**Answer (Andy, 2026-11-22): (a).** The adversarial check fails on should-fix too (`scripts/review-gate.mjs`, built in AI-215's PR); the verdict reads open findings from the review checks, and the findings source is optional.
The adversarial review check passes with should-fix findings (it fails only on blockers), and no findings store exists, so the verdict can't tell and waits.

- (a) The adversarial check fails on should-fix too, cleared by a fix or `review-accepted`: one line in `scripts/review-gate.mjs`; PRs with should-fix go red, which matches what the coordinator already holds back.
- (b) Store findings per PR head (ADR-0097's findings writer): the verdict reads them; an M-size ticket.
- (c) Ignore should-fix: merges PRs ADR-0124 calls not clean.
- Recommendation: (a), as its own ticket, then the verdict reads the check alone and the findings source becomes optional.
