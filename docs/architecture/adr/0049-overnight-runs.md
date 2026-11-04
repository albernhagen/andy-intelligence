---
status: accepted
date: 2026-11-04
amends: 0021, 0040
---

# 0049 — Overnight runs: launch an epic in the evening, review one PR in the morning

Decided by Andy, 2026-11-04.

## Context and Problem Statement

Andy wants to launch larger features before stepping away and come back to working code, a summary and the implementation details to review. Runs already execute in GitHub Actions without his machine, and the goal is autonomy by default (§1 goal 4). But an epic would stall overnight on the current rules:

| Rule                                                  | Why it stalls                                           |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Refinement waits for Andy's answers (§4.2)            | A question raised at 1 a.m. waits until morning         |
| M/L plans wait for Andy's approval (ADR-0040)         | Every M/L story stops after its plan                    |
| No stacked PRs; Andy merges every PR (ADR-0021, §4.5) | Story 2 can't start until story 1 merges                |
| No summary beyond UI rollups                          | Nothing tells Andy in the morning what happened and why |
| Caps are per run                                      | Nothing bounds a whole night                            |

## Decision Outcome

An **overnight run** (planned for M5: Epics + story board) is an epic Andy launches explicitly:

| Piece            | Decision                                                                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch step      | Before launch, in one batched session (UI or MCP): the epic is refined and split, every story's questions are answered, every story's plan is approved. Launch is refused while anything is open. Andy sets the night budget and a stop time.                                                       |
| While unattended | New ambiguity is decided on documented assumptions (recorded on the story, never silently) instead of waiting. Anything that needs Andy anyway (trust-boundary paths, a blocker that can't be fixed, budget reached) stops that story and flags it for the morning; the rest of the epic continues. |
| Epic branch      | Stories merge into a short-lived branch `epic/<key>` once their own checks and both review agents pass (no blockers, no high/critical). Dependent stories build on it. Exception to ADR-0021's "no stacked PRs", for one night only: the branch is merged or closed the next morning.               |
| Morning review   | One PR `epic/<key>` → `main`, reviewed story by story (each story is its own commit range). Andy merges as usual; nothing reaches `main` or prod without him.                                                                                                                                       |
| Morning report   | A Needs-you item (email later, `Notifier`): per story what was built and how, PR links, every assumption made, review findings and how they were answered, test and verification evidence, cost and tokens, and what's blocked and why.                                                             |
| Night budget     | Max runs, tokens and API-equivalent dollars per launch, plus a stop time. Reached → no new runs; in-flight runs finish; the report says so. The kill switch and per-run caps still apply (ADR-0028).                                                                                                |
| Evidence         | From M6: Dev → prod releases, the epic branch deploys to dev and runs the e2e suite before the report, so the morning PR shows the feature working.                                                                                                                                                 |

Builds on ADR-0047's coordination (sync runs, conflict-aware dispatch) and ADR-0040's plan step and verification output.

### Consequences

- Good: hours away from the keyboard turn into reviewed-ready features; Andy's decisions happen up front, in one sitting; one PR to review per feature.
- Bad: assumptions made overnight can be wrong and cost a rework cycle; a bad story early in the night can taint later ones on the epic branch (the morning review sees it whole); quota spent overnight is gone for daytime use (the night budget bounds it).
