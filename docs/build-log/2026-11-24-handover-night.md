# 2026-11-24 — Handover: the night of 2026-11-23 (coordinator)

For a fresh session with no chat history. One coordinator session ran worker sessions from 21:15 MST on 2026-11-23 on Andy's order: finish the approved work, then build epic AI-357: Design and UX. Facts come from `gh pr list`, `scripts/coordinator/survey.mjs` and MCP `status`, read at 01:15 MST on 2026-11-24. Terms: [glossary](../architecture/glossary.md).

## 1. Merged (by Andy, before he went to bed)

| Ticket                                                               | PR   |
| -------------------------------------------------------------------- | ---- |
| AI-356: Record Andy's decisions                                      | #388 |
| AI-351: Parity: revoke a runner over MCP                             | #389 |
| AI-355: Product discovery before the brief                           | #390 |
| AI-360: Drop the shared contract suite for ports with one adapter    | #393 |
| AI-362: Word budgets: hard limits only on files every agent loads    | #394 |
| AI-220: Merge modes: coordinator sessions merge through MCP merge_pr | #392 |
| AI-361: Write down the reviewer seam                                 | #396 |
| AI-365: A case on every milestone before Andy approves it            | #397 |

Main is `6047c055` (AI-365) and green, deploy included.

## 2. Waiting for Andy's merge

Nothing merged after AI-365. No session can merge: a worker's MCP `merge_pr` call was refused by the auto-mode permission check on Andy's machine, and the procedure allows no other way.

Clean (synced with main, every check green, both reviews clean on the head), base `main`:

| PR   | Ticket                                                                            | After the merge                                              |
| ---- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| #403 | AI-110: M5.18: Merge queue per repo                                               | Nothing to apply. Then retarget #405 to `main`.              |
| #400 | AI-217: Merge modes: GitHub enforces the kinds Andy keeps                         | Apply the ruleset: runbook `onboard-a-repo.md` §1b.          |
| #399 | AI-358: Docs-only PRs skip agent evals, UI screenshots and the Firestore suite    | The skip shows on the first docs-only PR after it.           |
| #401 | AI-359: Narrower rules                                                            | Decide the proposed ADRs in `2026-11-23-proposed-adrs.md`.   |
| #404 | AI-364: The dispatcher and gate match what a coordinator session does (docs only) | Approve or drop its eight proposed tickets (P1 to P8).       |
| #402 | AI-366: Screenshot coverage                                                       | Then retarget #409 to `main`. Also inside the epic PR, #419. |

Stacked on Andy's word, clean on their own base:

| PR   | Ticket                                           | Base          |
| ---- | ------------------------------------------------ | ------------- |
| #405 | AI-216: Merge modes: epic PR mode                | #403's branch |
| #409 | AI-353: UI PRs show before and after screenshots | #402's branch |

## 3. Epic AI-357: Design and UX

Built as stacked PRs, one per ticket, each reviewed: #402 (AI-366), #406 (AI-367), #408 (AI-368), #407 (AI-369), #410 (AI-370), #411 to #418 (AI-371 to AI-378). Most carry one adversarial blocker, "Stacked PR", which no code clears.

**PR #419 (AI-379: Phone pass) is the epic PR.** Its branch `m11/ai-379-phone-pass` holds every ticket above merged together, plus the phone pass; its base was changed to `main` at 01:10 MST and its checks and reviews were rerunning on the full diff when this was written: not verified clean. Merging #419 lands the epic except AI-353. Then close #402, #406 to #408 and #410 to #418 and move their tickets to Done by hand (a PR event moves only AI-379).

Known gaps: AI-374 and AI-375 both regenerated six ticket-panel images (resolved only on the epic branch); screens AI-371 to AI-376 built their own page headers, while `PageHeader.tsx` (AI-378) is the shared one.

## 4. What got in the way

| Problem                                                                                  | Effect                                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| The desktop app starts sessions only on turns Andy begins                                | Later tickets went to idle or unarchived workers by message |
| Workers are archived when their PR merges; worktree folders are reused                   | One worker was told to make its own worktree                |
| A long-lived coordinator has no MCP tool deployed after it started (`merge_pr`)          | The coordinator could not call it                           |
| A re-sync merge leaves both review checks "not reviewed" until another push (seen twice) | One extra push per affected PR                              |

ADR numbers handed out: 0143 to 0153 (0146 and 0152 only if needed). Next free: 0154.
